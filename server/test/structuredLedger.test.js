import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { parseAuditSource } from "../src/scrutiny/core/parseAuditSource.js";
import { runScrutiny } from "../src/scrutiny/core/runScrutiny.js";
import { matchReferencedTransactions, reconcileCrossSources } from "../src/scrutiny/core/crossSourceReconciliation.js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

async function withFile(name, content, callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "structured-ledger-"));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content);
  try { return await callback(filePath); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("flat CSV profile locates a later header and preserves missing balances", async () => {
  const csv = "Client export\nAccount,Debit movement,Credit movement\nSales,0,450\nCash,450,0\n";
  await withFile("ledger.csv", csv, async (filePath) => {
    const parsed = await parseAuditSource({ filePath, originalName: "ledger.csv", role: "books_ledgers",
      sourceId: "csv", financialYear: "2025-2026", completeExport: true,
      profile: { layout: "flat", headerRow: 2, fields: { ledger: "Account",
        debits: "Debit movement", credits: "Credit movement" }, accountRoles: { Sales: "sales" } } });
    assert.equal(parsed.status, "ready");
    assert.equal(parsed.records.length, 2);
    assert.equal(parsed.records[0].accountRole, "sales");
    assert.equal(parsed.records[0].closingBalance, undefined);
    assert.equal(runScrutiny({ sources: [parsed], checkIds: ["B02"] }).results[0].status, "insufficient_data");
  });
});

test("flat ledger auto-maps a header within the first 100 rows without a profile", async () => {
  const csv = ["Company export", ...Array.from({ length: 25 }, () => ""),
    "Ledger Account,Dr Amount,Cr Amount", "Cash,125,0", "Sales,0,125"].join("\n");
  await withFile("auto.csv", csv, async (filePath) => {
    const parsed = await parseAuditSource({ filePath, originalName: "auto.csv", role: "books_ledgers",
      sourceId: "flat-auto", financialYear: "2025-2026", completeExport: true });
    assert.equal(parsed.status, "ready");
    assert.equal(parsed.records.length, 2);
    assert.equal(parsed.records[0].debits, "125.00");
    assert.equal(parsed.records[1].credits, "125.00");
  });
});

test("nested JSON profile expands voucher postings without multiplying voucher totals", async () => {
  const input = { data: { entries: [{ ref: "V1", incomeAmount: "200.00", postings: [
    { acct: "Cash", drcr: "Dr", value: "200.00" },
    { acct: "Sales", drcr: "Cr", value: "200.00" },
  ] }] } };
  await withFile("nested.json", JSON.stringify(input), async (filePath) => {
    const parsed = await parseAuditSource({ filePath, originalName: "nested.json", role: "books_vouchers",
      sourceId: "json", financialYear: "2025-2026", completeExport: true,
      profile: { recordsPath: "data.entries", fields: { voucherId: "ref", ledger: "acct",
        side: "drcr", amount: "value" }, accountRoles: { Sales: "sales" } } });
    assert.equal(parsed.status, "ready");
    assert.equal(parsed.records.length, 2);
    assert.equal(parsed.records[1].accountRole, "sales");
    assert.equal(parsed.records[1].incomeAmount, undefined);
  });
});

test("multi-sheet XLSX and genuine BIFF8 XLS are read by signature", async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["instructions"]]), "Notes");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Account", "Dr", "Cr"], ["Sales", "0", "100"],
  ]), "Rows");
  for (const [name, bookType, expected] of [["data.xlsx", "xlsx", "xlsx"],
    ["data.xls", "biff8", "xls"]]) {
    const bytes = XLSX.write(workbook, { type: "buffer", bookType });
    await withFile(name, bytes, async (filePath) => {
      const parsed = await parseAuditSource({ filePath, originalName: name, role: "books_ledgers",
        sourceId: name, financialYear: "2025-2026", completeExport: true,
        profile: { sheetNames: ["Rows"], fields: { ledger: "Account", debits: "Dr", credits: "Cr" } } });
      assert.equal(parsed.format, expected);
      assert.equal(parsed.status, "ready");
      assert.equal(parsed.records[0].credits, "100.00");
      assert.equal(parsed.rawRows.length, 2);
    });
  }
});

test("Tally XML voucher postings retain ledger and voucher provenance", async () => {
  const xml = `<?xml version="1.0"?><ENVELOPE><BODY><DATA><TALLYMESSAGE><VOUCHER>
    <DATE>20250412</DATE><VOUCHERNUMBER>V7</VOUCHERNUMBER><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>Cash</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-100</AMOUNT></ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>100</AMOUNT></ALLLEDGERENTRIES.LIST>
    </VOUCHER></TALLYMESSAGE></DATA></BODY></ENVELOPE>`;
  await withFile("tally.xml", xml, async (filePath) => {
    const parsed = await parseAuditSource({ filePath, originalName: "tally.xml", role: "books_vouchers",
      sourceId: "xml", financialYear: "2025-2026", completeExport: true });
    assert.equal(parsed.format, "xml");
    assert.equal(parsed.status, "ready");
    assert.deepEqual(parsed.records.map((row) => row.side), ["debit", "credit"]);
    assert.equal(parsed.records[1].voucherId, "V7");
  });
});

test("configured repeated sections retain movements without inventing a close", async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Account:", "Service revenue"],
    ["Posting Date", "Details", "Voucher No", "Dr Amount", "Cr Amount"],
    ["12-Apr-25", "Customer", "INV-1", "", "250"],
  ]), "Ledger");
  await withFile("sections.xlsx", XLSX.write(book, { type: "buffer", bookType: "xlsx" }), async (filePath) => {
    const parsed = await parseAuditSource({ filePath, originalName: "sections.xlsx", role: "books_ledgers",
      sourceId: "sections", financialYear: "2025-2026", completeExport: true,
      profile: { layout: "ledger_sections", sectionMarker: "Account:", ledgerNameColumn: 1,
        fields: { date: "Posting Date", counterparty: "Details", voucherId: "Voucher No",
          debit: "Dr Amount", credit: "Cr Amount" },
        accountRoles: { "Service revenue": "sales" } } });
    assert.equal(parsed.status, "ready");
    assert.equal(parsed.records[0].credits, "250.00");
    assert.equal(parsed.records[0].closingBalance, undefined);
    assert.equal(parsed.records[0].entries[0].voucherId, "INV-1");
  });
});

test("automatic section headers search 100 rows, retain address and balance controls", async () => {
  const book = XLSX.utils.book_new();
  const matrix = [["Example Traders"], ["Ledger:", "Cash", "1-Apr-25 to 31-Mar-26"],
    ["Registered office, Rajkot"], ...Array.from({ length: 75 }, () => []),
    ["Voucher Date", "Description", "", "Voucher Type", "Voucher Number", "Dr Amount", "Cr Amount"],
    ["1-Apr-25", "Dr", "Opening Balance", "", "", "100.00", ""],
    ["2-Apr-25", "Cr", "Customer", "Receipt", "R-1", "", "25.00"],
    ["", "Dr", "Closing Balance", "", "", "", "75.00"],
    ["Ledger:", "Revenue", "1-Apr-25 to 31-Mar-26"],
    ["Date", "Particulars", "", "Vch Type", "Vch No.", "Debit", "Credit"],
    ["3-Apr-25", "Cr", "Customer", "Sales", "S-1", "", "60.00"]];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(matrix), "Ledgers");
  await withFile("sections.xlsx", XLSX.write(book, { type: "buffer", bookType: "xlsx" }), async (filePath) => {
    const parsed = await parseAuditSource({ filePath, originalName: "sections.xlsx", role: "books_ledgers",
      sourceId: "auto", financialYear: "2025-2026", completeExport: true });
    assert.equal(parsed.status, "ready");
    assert.equal(parsed.records.length, 2);
    assert.equal(parsed.records[0].entityName, "Example Traders");
    assert.equal(parsed.records[0].openingBalance, "100.00");
    assert.equal(parsed.records[0].closingBalance, "75.00");
    assert.equal(parsed.records[0].entries[0].voucherId, "R-1");
    assert.equal(parsed.records[1].closingBalance, undefined);
    assert.equal(parsed.ledgerStatements[0].address[0], "Registered office, Rajkot");
    assert.equal(parsed.ledgerStatements[0].headerRow, 79);
  });
});

test("an unrecognized section heading stays visible as a parsing issue", async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Entity"], ["Ledger:", "Unknown"], ["Unknown heading", "Unknown amount"],
  ]), "Data");
  await withFile("unknown.xlsx", XLSX.write(book, { type: "buffer", bookType: "xlsx" }), async (filePath) => {
    const parsed = await parseAuditSource({ filePath, originalName: "unknown.xlsx", role: "books_ledgers",
      sourceId: "unknown", financialYear: "2025-2026", completeExport: true });
    assert.equal(parsed.status, "insufficient_data");
    assert(parsed.issues.some((issue) => issue.code === "AUDIT_LEDGER_HEADER_MISSING"));
    assert.equal(parsed.records.length, 0);
  });
});

test("separate company sections retain distinct ledger records and block cross-company comparison", async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Company: First Works"], ["Ledger:", "Sales"], ["Date", "Particulars", "Debit", "Credit"],
    ["2-Apr-25", "Customer A", "", "10"],
    ["Company: Second Works"], ["Ledger:", "Sales"], ["Date", "Particulars", "Debit", "Credit"],
    ["3-Apr-25", "Customer B", "", "20"],
  ]), "Accounts");
  await withFile("companies.xlsx", XLSX.write(book, { type: "buffer", bookType: "xlsx" }), async (filePath) => {
    const parsed = await parseAuditSource({ filePath, originalName: "companies.xlsx", role: "books_ledgers",
      sourceId: "entities", financialYear: "2025-2026", completeExport: true });
    assert.deepEqual(parsed.records.map((record) => record.entityName), ["First Works", "Second Works"]);
    assert.deepEqual(parsed.records.map((record) => record.credits), ["10.00", "20.00"]);
    assert.equal(parsed.status, "insufficient_data");
    assert(parsed.issues.some((issue) => issue.code === "AUDIT_MULTIPLE_ENTITIES"));
  });
});

test("cash scrutiny flags a negative running balance only for mapped cash accounts", () => {
  const source = { sourceId: "cash", role: "books_ledgers", status: "ready", records: [{
    ledger: "Cash", accountRole: "cash", openingBalance: "20.00", entries: [
      { date: "1-Apr-25", side: "credit", amount: "30.00", provenance: { sourceId: "cash", rowNumber: 4 } },
      { date: "2-Apr-25", side: "debit", amount: "15.00", provenance: { sourceId: "cash", rowNumber: 5 } },
    ],
  }] };
  const result = runScrutiny({ sources: [source], checkIds: ["B05"] }).results[0];
  assert.equal(result.status, "review");
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].balance, "-10.00");
  assert.equal(runScrutiny({ sources: [{ ...source, records: [{ ...source.records[0], accountRole: null }] }],
    checkIds: ["B05"] }).results[0].status, "insufficient_data");
});

test("reference matching supports splits and reports both unmatched sides and ambiguity", () => {
  const year = "2025-2026";
  const book = (reference, amount, counterparty = "A", date = "2025-04-12") => ({ accountRole: "sales",
    financialYear: year, side: "credit", amount, reference, counterparty, date });
  const support = (reference, amount, party = "A", period = "APR-2025") => ({ reference, amount, party, period });
  const rows = matchReferencedTransactions([
    book("INV-1", "40.00"), book("INV-1", "60.00"),
    book("BOOK-ONLY", "20.00"), book("AMB-1", "10.00", "B"),
  ], [support("INV-1", "100.00"), support("SUPPORT-ONLY", "30.00"),
    support("AMB-1", "10.00", "C")], { role: "sales", year });
  const byRef = new Map(rows.map((row) => [row.reference, row]));
  assert.equal(byRef.get("INV-1").comparison, "matched");
  assert.equal(byRef.get("INV-1").bookRecordCount, 2);
  assert.deepEqual(byRef.get("INV-1").actualEntries.map((row) => row.amount), ["40.00", "60.00"]);
  assert.deepEqual(byRef.get("INV-1").expectedEntries.map((row) => row.amount), ["100.00"]);
  assert.equal(byRef.get("BOOK-ONLY").comparison, "unmatched_books");
  assert.equal(byRef.get("SUPPORT-ONLY").comparison, "unmatched_support");
  assert.equal(byRef.get("AMB-1").comparison, "ambiguous");
  const wrongPeriod = matchReferencedTransactions([book("SAME-REF", "50.00")],
    [support("SAME-REF", "50.00", "A", "MAY-2025")], { role: "sales", year });
  assert.deepEqual(new Set(wrongPeriod.map((row) => row.comparison)),
    new Set(["unmatched_books", "unmatched_support"]));
});

test("GST credit tax heads compare like-for-like with mapped book movements", () => {
  const year = "2025-2026";
  const book = { role: "books_ledgers", status: "ready", sourceId: "books", financialYear: year,
    taxpayerId: "24AADFA6153H1ZR", records: [
      { ledger: "Input CGST", accountRole: "gst_credit_cgst", entries: [
        { side: "debit", amount: "30.00", provenance: { sourceId: "books", rowNumber: 1 } },
        { side: "credit", amount: "10.00", provenance: { sourceId: "books", rowNumber: 2 } } ] },
      { ledger: "Input SGST", accountRole: "gst_credit_sgst", entries: [
        { side: "debit", amount: "30.00", provenance: { sourceId: "books", rowNumber: 3 } },
        { side: "credit", amount: "10.00", provenance: { sourceId: "books", rowNumber: 4 } } ] },
      { ledger: "Input IGST", accountRole: "gst_credit_igst", entries: [
        { side: "debit", amount: "5.00", provenance: { sourceId: "books", rowNumber: 5 } },
        { side: "credit", amount: "2.00", provenance: { sourceId: "books", rowNumber: 6 } } ] },
      { ledger: "Input cess", accountRole: "gst_credit_cess", entries: [
        { side: "debit", amount: "5.00", provenance: { sourceId: "books", rowNumber: 7 } },
        { side: "credit", amount: "2.00", provenance: { sourceId: "books", rowNumber: 8 } } ] },
    ] };
  const portal = { role: "supporting_document", status: "ready", sourceId: "portal",
    financialYear: year, taxpayerId: "24AADFA6153H1ZR", documentType: "gst_credit_ledger",
    records: [
      { kind: "transaction", side: "credit", taxHeads: { integrated: "5.00", central: "30.00", state: "30.00", cess: "5.00" },
        provenance: { sourceId: "portal", rowNumber: 1 } },
      { kind: "transaction", side: "debit", taxHeads: { integrated: "2.00", central: "10.00", state: "10.00", cess: "2.00" },
        provenance: { sourceId: "portal", rowNumber: 2 } },
    ] };
  const result = reconcileCrossSources([book, portal]);
  assert.equal(result.evidence.length, 8);
  assert.deepEqual(new Set(result.evidence.map((row) => row.accountRole)),
    new Set(["gst_credit_igst", "gst_credit_cgst", "gst_credit_sgst", "gst_credit_cess"]));
  assert(result.evidence.every((row) => row.differenceAmount === "0.00"));
  assert(result.evidence.every((row) => row.comparison === "review"));
  const wrongEntity = reconcileCrossSources([book, { ...portal, taxpayerId: "ABCDE1234F" }]);
  assert.equal(wrongEntity.status, "insufficient_data");
  assert.equal(wrongEntity.evidence.length, 0);
});

test("GST cash IGST and cess heads remain distinct from other tax heads", () => {
  const year = "2025-2026";
  const book = { role: "books_ledgers", status: "ready", sourceId: "books", financialYear: year,
    taxpayerId: "24AADFA6153H1ZR", records: [
      { ledger: "Cash IGST", accountRole: "gst_cash_igst", entries: [
        { side: "debit", amount: "7.00", provenance: { sourceId: "books", rowNumber: 1 } } ] },
      { ledger: "Cash cess", accountRole: "gst_cash_cess", entries: [
        { side: "debit", amount: "3.00", provenance: { sourceId: "books", rowNumber: 2 } } ] },
    ] };
  const portal = { role: "supporting_document", status: "ready", sourceId: "portal",
    financialYear: year, taxpayerId: "24AADFA6153H1ZR", documentType: "gst_cash_ledger",
    records: [
      { kind: "transaction", account: "integrated", side: "credit", amount: "7.00",
        provenance: { sourceId: "portal", rowNumber: 1 } },
      { kind: "transaction", account: "cess", side: "credit", amount: "3.00",
        provenance: { sourceId: "portal", rowNumber: 2 } },
    ] };
  const result = reconcileCrossSources([book, portal]);
  assert.equal(result.evidence.length, 2);
  assert.deepEqual(new Set(result.evidence.map((row) => row.accountRole)),
    new Set(["gst_cash_igst", "gst_cash_cess"]));
  assert(result.evidence.every((row) => row.differenceAmount === "0.00"));
});

test("cross-year ledger sections are sliced by posting year without a fabricated balance", async () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Ledger:", "Revenue"], ["Date", "Particulars", "Vch No.", "Debit", "Credit"],
    ["12-Apr-25", "Buyer A", "A", "", "100"],
    ["12-Apr-26", "Buyer B", "B", "", "200"],
  ]), "Ledger");
  await withFile("cross-year.xlsx", XLSX.write(book, { type: "buffer", bookType: "xlsx" }), async (filePath) => {
    for (const [financialYear, expected] of [["2025-2026", "100.00"], ["2026-2027", "200.00"]]) {
      const parsed = await parseAuditSource({ filePath, originalName: "cross-year.xlsx", role: "books_ledgers",
        sourceId: financialYear, financialYear, completeExport: true });
      assert.equal(parsed.financialYear, financialYear);
      assert.deepEqual(parsed.coverageYears, ["2025-2026", "2026-2027"]);
      assert.equal(parsed.records[0].credits, expected);
      assert.equal(parsed.records[0].closingBalance, undefined);
    }
  });
});
