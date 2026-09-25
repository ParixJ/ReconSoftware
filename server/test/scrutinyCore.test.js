import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { config } from "../src/config.js";
import { parseAuditSource, normalizeAuditRows } from "../src/scrutiny/core/parseAuditSource.js";
import { runScrutiny } from "../src/scrutiny/core/runScrutiny.js";
import { fromPaise, toPaise } from "../src/scrutiny/core/money.js";
import { normalizeMultiLedgerWorkbook } from "../src/scrutiny/core/multiLedgerWorkbook.js";
import { consumeAisGridPage, createAisTableState, finishAisTables } from "../src/scrutiny/core/aisTables.js";
import { resolvePdfIdentity } from "../src/scrutiny/core/pdfEvidence.js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const ref = (sourceId, rowNumber) => ({ sourceId, originalName: `${sourceId}.json`, rowNumber });
const source = (sourceId, role, records, extra = {}) => ({ sourceId, role, status: "ready", records, ...extra });

test("money is exact to paise and rejects hidden precision", () => {
  assert.equal(fromPaise(toPaise("0.10") + toPaise("0.20")), "0.30");
  assert.equal(fromPaise(toPaise("(1,23,456.70)")), "-123456.70");
  assert.throws(() => toPaise("1.001"));
});

test("canonical JSON vouchers retain posting provenance and completeness gate", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scrutiny-core-"));
  try {
    const filePath = path.join(dir, "books.json");
    await fs.writeFile(filePath, JSON.stringify({ completeExport: true, vouchers: [{
      voucherId: "V1", postings: [{ ledger: "Cash", side: "Dr", amount: "0.30" },
        { ledger: "Revenue", side: "Cr", amount: "0.30" }],
    }] }));
    const parsed = await parseAuditSource({ filePath, originalName: "books.json", role: "books_vouchers", sourceId: "s1" });
    assert.equal(parsed.status, "ready");
    assert.equal(parsed.records.length, 2);
    assert.deepEqual(parsed.records[1].provenance, { sourceId: "s1", originalName: "books.json", rowNumber: 1, postingNumber: 2 });
    assert.equal(runScrutiny({ sources: [parsed], checkIds: ["B01"] }).results[0].status, "matched");
    const unconfirmed = await parseAuditSource({ filePath, originalName: "books.json", role: "books_vouchers", sourceId: "s1", completeExport: false });
    assert.equal(unconfirmed.status, "insufficient_data");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("CSV ledger import rejects invalid rows instead of silently dropping them", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scrutiny-core-"));
  try {
    const filePath = path.join(dir, "ledgers.csv");
    await fs.writeFile(filePath, "ledger,openingBalance,debits,credits,closingBalance\nCash,10.00,1.00,0.00,11.00\nBank,not-money,0.00,0.00,0.00\n");
    const parsed = await parseAuditSource({ filePath, originalName: "ledgers.csv", role: "books_ledgers", sourceId: "s2", completeExport: true });
    assert.equal(parsed.status, "insufficient_data");
    assert.equal(parsed.recordCount, 1);
    assert.equal(parsed.issues[0].rowNumber, 3);
    const result = runScrutiny({ sources: [parsed], checkIds: ["B02"] }).results[0];
    assert.equal(result.status, "review");
    assert(result.evidence.some((item) => item.kind === "source_limitation"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("workbook sheets with invalid headers surface extraction issues", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scrutiny-workbook-"));
  try {
    const filePath = path.join(dir, "ledgers.xlsx");
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["ledger", "ledger"],
      ["Bank", "Duplicate header row"],
    ]), "Bad");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["ledger", "openingBalance", "debits", "credits", "closingBalance"],
      ["Cash", "0.00", "10.00", "0.00", "10.00"],
    ]), "Good");
    XLSX.writeFile(workbook, filePath);
    const parsed = await parseAuditSource({ filePath, originalName: "ledgers.xlsx",
      role: "books_ledgers", sourceId: "wb", completeExport: true });
    assert.equal(parsed.recordCount, 1);
    assert.equal(parsed.status, "insufficient_data");
    assert.ok(parsed.issues.some((issue) =>
      issue.code === "AUDIT_TABLE_HEADER_INVALID" && issue.sheetName === "Bad"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("case scrutiny query workbooks preserve manual differences across sheets", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scrutiny-query-"));
  try {
    const filePath = path.join(dir, "Scrutiny Query.xlsx");
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["", "Sanjar Traders F.Y. 2025-26"],
      [],
      ["", "Party Name", "Query"],
      [1, "Professional Fees", "Mismatch"],
      ["", "", "As Per Books", "", 0],
      ["", "", "As Per ARM Ledger", "", 7925],
      ["", "", "Difference", "", 7925],
      [2, "Fixed Assets", "Depreciation Roundoff"],
      ["", "Description of Assets", "Rate (%)", "W.D.V. As On 01/04/25", "Addition", "< 180 Days", "Deduction", "Depreciation", "W.D.V. As On 31/03/26"],
      ["", "Air Conditioner", 0.1, 43951.3, 0, 0, 0, 4395, 39556.3],
    ]), "Scrutiny Query");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Liabilities", "Account", "Report", "Difference", "Assets", "Account", "Report", "Difference"],
      ["Party A", 100, 101, -1, "Laptop", 200, 199.5, 0.5],
    ]), "Op.Bal. diff.");
    XLSX.writeFile(workbook, filePath);
    const parsed = await parseAuditSource({ filePath, originalName: "Scrutiny Query.xlsx",
      role: "supporting_document", sourceId: "queries", completeExport: true });
    assert.equal(parsed.status, "ready");
    assert.equal(parsed.documentType, "audit_queries");
    assert.equal(parsed.financialYear, "2025-2026");
    assert.equal(parsed.records.find((row) => row.queryType === "manual_amount_difference").differenceAmount,
      "7925.00");
    assert.equal(parsed.records.find((row) => row.queryType === "depreciation_schedule").depreciation,
      "4395.00");
    assert.equal(parsed.records.filter((row) => row.queryType === "opening_balance_difference").length, 2);

    const books = source("books", "books_ledgers", [{ ledger: "Sales", accountRole: "sales",
      entries: [{ side: "credit", amount: "1.00", date: "12-Apr-25", provenance: ref("books", 1) }] }],
    { financialYear: "2025-2026", taxpayerId: "ABCDE1234F" });
    const finding = runScrutiny({ sources: [books, parsed], checkIds: ["X01"],
      reportTaxpayerId: "ABCDE1234F" }).results[0];
    assert.equal(finding.status, "difference");
    assert.ok(finding.evidence.some((row) =>
      row.queryType === "manual_amount_difference" && row.differenceAmount === "7925.00"));
    assert.ok(finding.evidence.some((row) => row.queryType === "opening_balance_difference"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("PDF identity resolution can fall back to unlabeled full text for scanned statements", () => {
  const scoped = resolvePdfIdentity([{ text: "Annual Information Statement", pageNumber: 1, rowNumber: 1 }]);
  assert.equal(scoped.status, "insufficient_data");
  const fallback = resolvePdfIdentity([
    { text: "Annual Information Statement", pageNumber: 1, rowNumber: 1 },
    { text: "OCR recovered AGUPJ5375M from a later page", pageNumber: 3, rowNumber: 8 },
  ], { allowUnlabeled: true });
  assert.equal(fallback.taxpayerId, "AGUPJ5375M");
});

test("B01 through B04 compare exact balances and flag review candidates", () => {
  const vouchers = source("v", "books_vouchers", [
    { voucherId: "V1", side: "debit", amount: "10.10", provenance: ref("v", 1) },
    { voucherId: "V1", side: "credit", amount: "10.09", provenance: ref("v", 2) },
  ]);
  const ledgers = source("l", "books_ledgers", [
    { ledger: "Cash", openingBalance: "10.00", debits: "0.10", credits: "0.00", closingBalance: "10.10", provenance: ref("l", 1) },
    { ledger: "Old", openingBalance: "5.00", debits: "0.00", credits: "0.00", closingBalance: "5.00", provenance: ref("l", 2) },
  ], { taxpayerId: "ABCDE1234F" });
  const tb = source("t", "trial_balance", [
    { ledger: "Cash", openingDebit: "10.00", openingCredit: "0.00", closingDebit: "10.10", closingCredit: "0.00", provenance: ref("t", 1) },
    { ledger: "Revenue", openingDebit: "0.00", openingCredit: "10.00", closingDebit: "0.00", closingCredit: "10.09", provenance: ref("t", 2) },
  ], { taxpayerId: "ABCDE1234F" });
  const results = runScrutiny({ sources: [vouchers, ledgers, tb], checkIds: ["B01", "B02", "B03", "B04"] }).results;
  assert.deepEqual(results.map((item) => item.status), ["difference", "matched", "difference", "review"]);
  assert.equal(results[0].evidence[0].differenceAmount, "0.01");
  assert.equal(results[2].evidence[0].differenceAmount, "0.01");
  assert.equal(results[3].evidence[0].ledger, "Old");
  assert.deepEqual(results.map((item) => item.id), ["B01", "B02", "B03", "B04"]);
});

test("audit source normalization refuses over-limit record sets before persistence", async () => {
  const previous = config.maxAuditRecords;
  config.maxAuditRecords = 1;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scrutiny-limit-"));
  try {
    const filePath = path.join(dir, "books.json");
    await fs.writeFile(filePath, JSON.stringify({ completeExport: true, records: [
      { voucherId: "V1", ledger: "Cash", side: "Dr", amount: "1.00" },
      { voucherId: "V1", ledger: "Sales", side: "Cr", amount: "1.00" },
    ] }));
    const parsed = await parseAuditSource({ filePath, originalName: "books.json",
      role: "books_vouchers", sourceId: "limit", completeExport: true });
    assert.equal(parsed.status, "insufficient_data");
    assert.deepEqual(parsed.records, []);
    assert.equal(parsed.issues[0].code, "AUDIT_SOURCE_LIMIT_EXCEEDED");
  } finally {
    config.maxAuditRecords = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("B01 does not net distinct vouchers sharing an ID into a false balance", () => {
  const vouchers = source("duplicates", "books_vouchers", [
    { voucherId: "V1", date: "2025-04-01", voucherType: "Sales", side: "debit", amount: "100.00", provenance: ref("duplicates", 1) },
    { voucherId: "V1", date: "2025-04-02", voucherType: "Sales", side: "credit", amount: "100.00", provenance: ref("duplicates", 2) },
  ]);
  const [result] = runScrutiny({ sources: [vouchers], checkIds: ["B01"] }).results;
  assert.equal(result.status, "review");
  assert.equal(result.evidence[0].comparison, "ambiguous_duplicate_voucher");
});

test("UTF-16 Tally multi-ledger JSON retains duplicate ledger keys and signed debit postings", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scrutiny-tally-"));
  try {
    const filePath = path.join(dir, "Tally.json");
    const ledger = (name, amountKey, amount) => `"mlvledbody":{"lvacctitle":{"lvacctitle":{"lvacctitle":"${name}","lvbody":{"dspvchdetail":{"dspvchdate":"01-Apr-25","dspvchtype":"Jrnl","${amountKey}":${amount},"dspvchnumber":{"dspvchnumber":{"dspexplvchnumber":"1"}}},"lvclosingbalance":{"lvfcthree":{}}}}}}`;
    const raw = `{"mlvbody":{${ledger("Cash", "dspvchdramt", -100)},${ledger("Revenue", "dspvchcramt", 100)}},"metadata":{"amount":Cr,"fee":-$2.00}}`;
    await fs.writeFile(filePath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(raw, "utf16le")]));
    const parsed = await parseAuditSource({ filePath, originalName: "Tally.json", role: "books_vouchers",
      sourceId: "tally", financialYear: "2025-2026", completeExport: true });
    assert.equal(parsed.status, "ready");
    assert.equal(parsed.recordCount, 2);
    assert.equal(parsed.parseWarnings.length, 1);
    assert.equal(runScrutiny({ sources: [parsed], checkIds: ["B01"] }).results[0].status, "matched");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("multi-ledger account statements exclude unlabeled subtotals and preserve balances", () => {
  const rows = [
    ["Account Statement For Cash", null, null, null],
    ["From 01/04/2025 To 31/03/2026", null, null, null],
    ["Credit", "Particulars", "Debit", "Particulars"],
    [null, null, 10, "DB Opening Balance"],
    [4, "02/04/2025 Jrnl", null, null],
    [null, "Customer A", null, null],
    [null, "Bill No INV-1", null, null],
    [null, "Vou No JV-7", null, null],
    [4, null, null, null],
    [6, "DB Closing Balance", null, null],
    [10, null, 10, null],
  ];
  const parsed = normalizeMultiLedgerWorkbook({ rows, sourceId: "sheet", originalName: "multi.xlsx",
    completeExport: true, fiscalYear: "2025-2026", normalizeRows: normalizeAuditRows });
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.rawRows.length, 11);
  assert.deepEqual(parsed.records[0].openingBalance, "10.00");
  assert.deepEqual(parsed.records[0].credits, "4.00");
  assert.deepEqual(parsed.records[0].closingBalance, "6.00");
  assert.deepEqual(parsed.records[0].entries.map((entry) =>
    [entry.side, entry.amount, entry.date, entry.counterparty, entry.billReference]),
  [["credit", "4.00", "02/04/2025", "Customer A", "INV-1"]]);
  assert.equal(parsed.records[0].entries[0].voucherId, "JV-7");
  assert.equal(runScrutiny({ sources: [parsed], checkIds: ["B02"] }).results[0].status, "matched");
});

test("multi-ledger statements do not invent zero balances when the control lines are absent", () => {
  const rows = [
    ["Account Statement For Suspense Account"],
    ["From 01/04/2025 To 31/03/2026"],
    ["Credit", "Particulars", "Debit", "Particulars"],
    [4, "02/04/2025 Jrnl", null, null],
    [null, null, 4, "03/04/2025 Jrnl"],
    [4, null, 4, null],
  ];
  const parsed = normalizeMultiLedgerWorkbook({ rows, sourceId: "no-controls", originalName: "no-controls.xlsx",
    completeExport: true, fiscalYear: "2025-2026", normalizeRows: normalizeAuditRows });
  assert.equal(parsed.records[0].openingBalance, undefined);
  assert.equal(parsed.records[0].closingBalance, undefined);
  assert.equal(runScrutiny({ sources: [parsed], checkIds: ["B02"] }).results[0].status, "insufficient_data");
});

test("negative cash scrutiny replays same-day entries instead of netting the day", () => {
  const ledger = source("cash", "books_ledgers", [{
    ledger: "Cash", accountRole: "cash", openingBalance: "50.00", closingBalance: "50.00",
    entries: [
      { date: "01/04/2025", side: "credit", amount: "60.00", provenance: ref("cash", 1) },
      { date: "01/04/2025", side: "debit", amount: "60.00", provenance: ref("cash", 2) },
    ],
    provenance: ref("cash", 0),
  }]);
  const result = runScrutiny({ sources: [ledger], checkIds: ["B05"] }).results[0];
  assert.equal(result.status, "review");
  assert.equal(result.evidence[0].balance, "-10.00");
  assert.equal(result.evidence[0].transactionIndex, 1);
});

test("paired ledger headings are matched after a long preamble and shifted columns", () => {
  const rows = [["Example Works"], ["Account Statement For Cash"],
    ["From 01/04/2025 To 31/03/2026"], ...Array.from({ length: 30 }, () => []),
    ["", "Cr Amount", "Details", "Dr Amount", "Details"],
    ["", null, null, 10, "DB Opening Balance"],
    ["", 4, "02/04/2025 Jrnl", null, null],
    ["", null, "Customer", null, null],
    ["", 6, "DB Closing Balance", null, null],
    ["", 10, null, 10, null]];
  const parsed = normalizeMultiLedgerWorkbook({ rows, sourceId: "shifted", originalName: "shifted.xlsx",
    completeExport: true, fiscalYear: "2025-2026", normalizeRows: normalizeAuditRows });
  assert.equal(parsed.status, "ready");
  assert.equal(parsed.records[0].entries[0].provenance.columnNumber, 2);
  assert.equal(parsed.records[0].closingBalance, "6.00");
  assert.equal(parsed.ledgerStatements[0].headerRow, 34);
});

test("AIS grid rows retain table identity and require printed count and amount controls", async () => {
  const row = (cells, rowNumber) => ({ cells, pageNumber: 1, rowNumber,
    top: rowNumber * 30, bottom: rowNumber * 30 + 25,
    bounds: Array.from({ length: cells.length + 1 }, (_, index) => index * 100) });
  const summary = row(["1", "TDS-194Q", "Payment of certain sums by buyer (Section 194Q)",
    "Buyer A", "1", "100"], 1);
  const detail = row(["1", "Q1(Apr-Jun)", "30/04/2025", "110", "1", "1", "Active"], 2);
  const page = { rows: [summary, detail], refineCell: async (item, column) => ({
    text: item === detail && column === 3 ? "100" : item.cells[column], confidence: 95,
  }) };
  const state = createAisTableState({ sourceId: "ais", originalName: "AIS.pdf",
    taxpayerId: "ABCDE1234F", financialYear: "2025-2026" });
  await consumeAisGridPage(state, page);
  const parsed = finishAisTables(state);
  assert.equal(parsed.tables[0].status, "verified");
  assert.equal(parsed.records[0].amount, "100.00");
  assert.equal(parsed.records[0].tableId, parsed.tables[0].id);
  assert.deepEqual(parsed.records[0].provenance.box, [300, 60, 400, 85]);
  const mismatched = createAisTableState({ sourceId: "other", originalName: "AIS.pdf",
    taxpayerId: "ABCDE1234F", financialYear: "2025-2026" });
  await consumeAisGridPage(mismatched, { rows: [summary, detail],
    refineCell: async (item, column) => ({ text: item.cells[column], confidence: 95 }) });
  assert.equal(finishAisTables(mismatched).tables[0].status, "unverified");

  const rounded = createAisTableState({ sourceId: "rounded", originalName: "AIS.pdf",
    taxpayerId: "ABCDE1234F", financialYear: "2025-2026" });
  rounded.tables.push({ id: "rounded:table:1", informationCode: "EXC-GSTR1(P)",
    category: "EXC-GSTR1(P)", expectedCount: 2, expectedAmount: "102.00",
    countReading: { candidates: [{ value: "2" }] },
    totalReading: { candidates: [{ value: "102" }] },
    provenance: { sourceId: "rounded", pageNumber: 1 }, issues: [], rows: [
      { status: "active", period: "APR-2025", amount: "50.00",
        amountReading: { candidates: [{ value: "50" }] } },
      { status: "active", period: "MAY-2025", amount: "51.00",
        amountReading: { candidates: [{ value: "51" }] } },
    ] });
  const withRounding = finishAisTables(rounded);
  assert.equal(withRounding.tables[0].status, "verified_with_rounding");
  assert.equal(withRounding.tables[0].roundingDifferenceAmount, "-1.00");
  assert.equal(withRounding.warnings[0].code, "AIS_TABLE_ROUNDING_DIFFERENCE");
});

test("AIS OCR summaries remain review-only when cross-checked with Form 26AS", () => {
  const ais = source("ais", "ais", [
    { section: "194A", reference: "RKTP01386A", amount: "11043.00", provenance: ref("ais", 1) },
    { section: "206CE", reference: "RKTA01598C", amount: "72719374.00", provenance: ref("ais", 2) },
  ], { documentType: "ais", status: "insufficient_data", taxpayerId: "ABCDE1234F", financialYear: "2025-2026" });
  const form = source("form", "supporting_document", [
    { section: "194A", tan: "RKTP01386A", amount: "11043.00", party: "Power Company", provenance: ref("form", 1) },
    { section: "206CE", tan: "RKTA01598C", amount: "7279374.00", party: "Collector", provenance: ref("form", 2) },
  ], { documentType: "form_26as", taxpayerId: "ABCDE1234F", financialYear: "2025-2026" });
  const result = runScrutiny({ sources: [ais, form], checkIds: ["A26"] }).results[0];
  assert.equal(result.status, "review");
  assert.deepEqual(result.evidence.map((item) => item.comparison), ["candidate_agrees", "candidate_differs"]);
  const incompleteForm = { ...form, status: "insufficient_data",
    issues: [{ code: "AUDIT_EXPORT_COMPLETENESS_UNCONFIRMED", message: "Completeness unconfirmed." }] };
  assert.equal(runScrutiny({ sources: [ais, incompleteForm], checkIds: ["A26"] }).results[0].status,
    "review");
  assert.equal(runScrutiny({ sources: [ais, { ...form, taxpayerId: "ZZZZZ1234Z" }],
    checkIds: ["A26"] }).results[0].status, "insufficient_data");
});

test("GST portal and product quantities use independent exact roll-forward controls", () => {
  const credit = source("credit", "supporting_document", [
    { kind: "opening", account: "all_tax_heads", balance: "0.00", provenance: ref("credit", 1) },
    { kind: "transaction", account: "all_tax_heads", side: "credit", amount: "100.00", balance: "100.00", provenance: ref("credit", 2) },
    { kind: "transaction", account: "all_tax_heads", side: "debit", amount: "25.00", balance: "75.00", provenance: ref("credit", 3) },
    { kind: "closing", account: "all_tax_heads", balance: "75.00", provenance: ref("credit", 4) },
  ], { documentType: "gst_credit_ledger", taxpayerId: "24ABCDE1234F1Z0", financialYear: "2025-2026" });
  const stock = source("stock", "supporting_document", [
    { kind: "opening", product: "Widget", quantity: "1.125", provenance: ref("stock", 1) },
    { kind: "movement", product: "Widget", receiptQuantity: "0.250", issueQuantity: "0.125", provenance: ref("stock", 2) },
    { kind: "closing", product: "Widget", receiptTotal: "1.375", issueTotal: "0.125", quantity: "1.250", provenance: ref("stock", 3) },
  ], { documentType: "stock_product_ledger" });
  assert.deepEqual(runScrutiny({ sources: [credit, stock], checkIds: ["G01", "S01"] }).results
    .map((item) => item.status), ["matched", "matched"]);
  const incomplete = (item) => ({ ...item, status: "insufficient_data",
    issues: [{ code: "AUDIT_EXPORT_COMPLETENESS_UNCONFIRMED", message: "Completeness unconfirmed." }] });
  const provisional = runScrutiny({ sources: [incomplete(credit), incomplete(stock)],
    checkIds: ["G01", "S01"] }).results;
  assert.deepEqual(provisional.map((item) => item.status), ["review", "review"]);
  assert(provisional.every((item) => item.evidence.some((row) => row.kind === "source_limitation")));
  assert.equal(runScrutiny({ sources: [{ ...credit, records: credit.records.map((row, index) =>
    index === 2 ? { ...row, balance: "74.00" } : row) }], checkIds: ["G01"] }).results[0].status, "difference");
});

test("TDS and TCS book movements remain a review rather than a false 26AS match", () => {
  const books = source("books", "books_vouchers", [
    { ledger: "TDS Receivable", accountRole: "tds_receivable", side: "debit", amount: "50.00", provenance: ref("books", 1) },
    { ledger: "TCS Receivable", accountRole: "tcs_receivable", side: "debit", amount: "30.00", provenance: ref("books", 2) },
  ], { taxpayerId: "ABCDE1234F" });
  const form = source("form", "supporting_document", [
    { type: "tds", taxAmount: "50.00", provenance: ref("form", 1) },
    { type: "tcs", taxAmount: "30.00", provenance: ref("form", 2) },
  ], { documentType: "form_26as", taxpayerId: "ABCDE1234F" });
  const result = runScrutiny({ sources: [books, form], checkIds: ["T03"] }).results[0];
  assert.equal(result.status, "review");
  assert.equal(result.evidence.length, 2);
});

test("verified AIS turnover compares monthly net sales-ledger movements with rounding visible", () => {
  const ledger = source("ledger", "books_ledgers", [{ ledger: "Sales A/c. (GST)", accountRole: "sales", entries: [
    { date: "03/04/2025", side: "credit", amount: "100.25", provenance: ref("ledger", 1) },
    { date: "14/04/2025", side: "debit", amount: "10.00", provenance: ref("ledger", 2) },
  ] }], { financialYear: "2025-2026", entityName: "Sample Books", taxpayerId: "ABCDE1234F" });
  const ais = source("ais", "ais", [], { status: "insufficient_data", documentType: "ais",
    taxpayerId: "ABCDE1234F", financialYear: "2025-2026", tables: [{
      id: "turnover", informationCode: "EXC-GSTR3B", status: "verified", rows: [
        { period: "APR-2025", status: "active", taxableValue: "90.00", provenance: ref("ais", 1) },
      ],
    }] });
  const finding = runScrutiny({ sources: [ledger, ais], checkIds: ["AIS02"] }).results[0];
  assert.equal(finding.status, "review");
  assert.equal(finding.evidence[0].differenceAmount, "-0.25");
  assert.equal(finding.evidence[0].withinRupeeRounding, true);
});

test("Form 26AS and GST portal movements compare against dated multi-ledger entries", () => {
  const ledger = source("ledger", "books_ledgers", [
    { ledger: "T D S A/c (Rajkot)", accountRole: "tds_receivable", openingBalance: "0.00", closingBalance: "11.00", entries: [
      { side: "debit", amount: "11.00", provenance: ref("ledger", 1) },
    ] },
    { ledger: "Cash Ledger(CGST) - Primary Unit", accountRole: "gst_cash_cgst", entries: [
      { side: "debit", amount: "50.00", provenance: ref("ledger", 2) },
      { side: "credit", amount: "40.00", provenance: ref("ledger", 3) },
    ] },
  ], { financialYear: "2025-2026", taxpayerId: "ABCDE1234F" });
  const form = source("form", "supporting_document", [
    { type: "tds", taxAmount: "11.00", provenance: ref("form", 1) },
  ], { documentType: "form_26as", taxpayerId: "ABCDE1234F", financialYear: "2025-2026" });
  const cash = source("cash", "supporting_document", [
    { kind: "transaction", account: "central", side: "credit", amount: "50.00", provenance: ref("cash", 1) },
    { kind: "transaction", account: "central", side: "debit", amount: "45.00", provenance: ref("cash", 2) },
  ], { documentType: "gst_cash_ledger", taxpayerId: "24ABCDE1234F1Z0", financialYear: "2025-2026" });
  const [tax, gst] = runScrutiny({ sources: [ledger, form, cash], checkIds: ["T03", "G02"] }).results;
  assert.equal(tax.status, "review");
  assert.equal(tax.evidence[0].differenceAmount, "0.00");
  assert.equal(gst.status, "review");
  assert.equal(gst.evidence[0].depositDifference, "0.00");
  assert.equal(gst.evidence[0].utilizationDifference, "5.00");
});

test("voucher and ledger exports require explicit cross-source coverage", () => {
  const vouchers = source("vouchers", "books_vouchers", [
    { ledger: "Cash A/c", side: "debit", amount: "10.00", provenance: ref("vouchers", 1) },
    { ledger: "Revenue", side: "credit", amount: "10.00", provenance: ref("vouchers", 2) },
  ], { financialYear: "2025-2026", taxpayerId: "ABCDE1234F" });
  const statements = source("statements", "books_ledgers", [
    { ledger: "Cash A/c", debits: "10.00", credits: "0.00", provenance: ref("statements", 1) },
    { ledger: "Revenue", debits: "0.00", credits: "10.00", provenance: ref("statements", 2) },
  ], { financialYear: "2025-2026", taxpayerId: "ABCDE1234F" });
  assert.equal(runScrutiny({ sources: [vouchers, statements], checkIds: ["B20"] }).results[0].status, "matched");
  const unmapped = { ...statements, records: [statements.records[0],
    { ...statements.records[1], ledger: "Other revenue" }] };
  const result = runScrutiny({ sources: [vouchers, unmapped], checkIds: ["B20"] }).results[0];
  assert.equal(result.status, "insufficient_data");
  assert.match(result.summary, /1\/2 statement ledgers map/);
});

test("B03 catches book-ledger differences even when the trial balance balances internally", () => {
  const ledgers = source("l", "books_ledgers", [
    { ledger: "Bank", openingBalance: "0.00", debits: "10.00", credits: "0.00", closingBalance: "10.00", provenance: ref("l", 1) },
    { ledger: "Revenue", openingBalance: "0.00", debits: "0.00", credits: "10.00", closingBalance: "-10.00", provenance: ref("l", 2) },
  ], { taxpayerId: "ABCDE1234F" });
  const trial = source("t", "trial_balance", [
    { ledger: "Bank", openingDebit: "0.00", openingCredit: "0.00", closingDebit: "11.00", closingCredit: "0.00", provenance: ref("t", 1) },
    { ledger: "Revenue", openingDebit: "0.00", openingCredit: "0.00", closingDebit: "0.00", closingCredit: "11.00", provenance: ref("t", 2) },
  ], { taxpayerId: "ABCDE1234F" });
  const finding = runScrutiny({ sources: [ledgers, trial], checkIds: ["B03"] }).results[0];
  assert.equal(finding.status, "difference");
  assert.equal(finding.evidence.length, 2);
  assert.equal(finding.evidence[0].differenceAmount, "1.00");
});

test("cross-source checks require compatible taxpayer identity or report identity", () => {
  const ledgers = source("l", "books_ledgers", [
    { ledger: "Bank", openingBalance: "0.00", debits: "10.00", credits: "0.00", closingBalance: "10.00", provenance: ref("l", 1) },
    { ledger: "Revenue", openingBalance: "0.00", debits: "0.00", credits: "10.00", closingBalance: "-10.00", provenance: ref("l", 2) },
  ], { taxpayerId: "ABCDE1234F" });
  const trial = source("t", "trial_balance", [
    { ledger: "Bank", openingDebit: "0.00", openingCredit: "0.00", closingDebit: "10.00", closingCredit: "0.00", provenance: ref("t", 1) },
    { ledger: "Revenue", openingDebit: "0.00", openingCredit: "0.00", closingDebit: "0.00", closingCredit: "10.00", provenance: ref("t", 2) },
  ], { taxpayerId: "PQRST1234F" });
  assert.equal(runScrutiny({ sources: [ledgers, trial], checkIds: ["B03"] }).results[0].status,
    "insufficient_data");
  const missingLedgers = { ...ledgers, taxpayerId: null };
  const missingTrial = { ...trial, taxpayerId: null };
  assert.equal(runScrutiny({ sources: [missingLedgers, missingTrial], checkIds: ["B03"] }).results[0].status,
    "insufficient_data");
  assert.equal(runScrutiny({ sources: [missingLedgers, missingTrial], checkIds: ["B03"],
    reportTaxpayerId: "ABCDE1234F" }).results[0].status, "matched");
});

test("voucher-level income totals are not copied to every split posting", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scrutiny-income-"));
  try {
    const filePath = path.join(dir, "books.json");
    await fs.writeFile(filePath, JSON.stringify({ completeExport: true, vouchers: [{
      voucherId: "V1", incomeAmount: "20.00", incomeCategory: "INTEREST",
      taxpayerId: "ABCDE1234F", period: "2025-04", reference: "R1",
      postings: [{ ledger: "Bank", side: "debit", amount: "20.00" },
        { ledger: "Interest", side: "credit", amount: "20.00" }],
    }] }));
    const parsed = await parseAuditSource({ filePath, originalName: "books.json", role: "books_vouchers", sourceId: "b" });
    assert.equal(parsed.records.length, 2);
    assert.ok(parsed.records.every((record) => record.incomeAmount === undefined));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("P01 compares mapped signed balances and refuses nonconsecutive years", () => {
  const current = source("current", "trial_balance", [{ ledger: "Cash", openingDebit: "10.00", openingCredit: "0.00", closingDebit: "10.00", closingCredit: "0.00", provenance: ref("current", 1) }], { financialYear: "2025-26", taxpayerId: "ABCDE1234F" });
  const prior = source("prior", "prior_year_trial_balance", [{ ledger: "Cash", openingDebit: "8.00", openingCredit: "0.00", closingDebit: "9.99", closingCredit: "0.00", provenance: ref("prior", 1) }], { financialYear: "2024-25", taxpayerId: "ABCDE1234F" });
  assert.equal(runScrutiny({ sources: [current, prior], checkIds: ["P01"] }).results[0].evidence[0].differenceAmount, "0.01");
  prior.financialYear = "2023-24";
  assert.equal(runScrutiny({ sources: [current, prior], checkIds: ["P01"] }).results[0].status, "insufficient_data");
});

test("AIS01 compares only explicitly comparable income by taxpayer, category, period and reference", () => {
  const books = normalizeAuditRows({ role: "books_vouchers", sourceId: "b", originalName: "books.json", rows: [
    { rowNumber: 1, row: { voucherId: "V1", ledger: "Interest", side: "Cr", amount: "5.00",
      incomeAmount: "5.00", incomeCategory: "INTEREST", taxpayerId: "24ABCDE1234F1Z5", period: "2025-04", reference: "R1" } },
  ] });
  const ais = normalizeAuditRows({ role: "ais", sourceId: "a", originalName: "ais.json", rows: [
    { rowNumber: 1, row: { taxpayerId: "ABCDE1234F", category: "INTEREST", period: "2025-04", reference: "R1", amount: "5.01" } },
    { rowNumber: 2, row: { taxpayerId: "ABCDE1234F", category: "TAX_PAYMENT", period: "2025-04", reference: "T1", amount: "100.00" } },
  ] });
  const finding = runScrutiny({ sources: [books, ais], checkIds: ["AIS01"] }).results[0];
  assert.equal(finding.status, "difference");
  assert.equal(finding.evidence.length, 1);
  assert.equal(finding.evidence[0].differenceAmount, "0.01");
  assert.match(finding.summary, /1 non-comparable/);
  ais.records[0].amount = "5.00";
  assert.equal(runScrutiny({ sources: [books, ais], checkIds: ["AIS01"] }).results[0].status, "matched");
  delete ais.records[0].reference;
  assert.equal(runScrutiny({ sources: [books, ais], checkIds: ["AIS01"] }).results[0].status, "insufficient_data");
});

test("AIS02 compares GST turnover by period so offsetting months cannot match", () => {
  const books = normalizeAuditRows({ role: "books_vouchers", sourceId: "b", originalName: "books.json", rows: [
    { rowNumber: 1, row: { voucherId: "V1", ledger: "Sales", side: "Cr", amount: "10.00",
      taxableValue: "10.00", taxpayerId: "24ABCDE1234F1Z5", period: "2025-04" } },
    { rowNumber: 2, row: { voucherId: "V2", ledger: "Sales", side: "Cr", amount: "20.00",
      taxableValue: "20.00", taxpayerId: "24ABCDE1234F1Z5", period: "2025-05" } },
  ] });
  const ais = normalizeAuditRows({ role: "ais", sourceId: "a", originalName: "ais.json", rows: [
    { rowNumber: 1, row: { taxpayerId: "ABCDE1234F", category: "EXC-GSTR3B", period: "2025-04", reference: "A1", amount: "11.00" } },
    { rowNumber: 2, row: { taxpayerId: "ABCDE1234F", category: "EXC-GSTR3B", period: "2025-05", reference: "A2", amount: "19.00" } },
  ] });
  const finding = runScrutiny({ sources: [books, ais], checkIds: ["AIS02"] }).results[0];
  assert.equal(finding.status, "review");
  assert.deepEqual(finding.evidence.map((entry) => entry.differenceAmount), ["1.00", "-1.00"]);
  ais.records[0].amount = "10.00";
  ais.records[1].amount = "20.00";
  assert.equal(runScrutiny({ sources: [books, ais], checkIds: ["AIS02"] }).results[0].status, "matched");
  delete books.records[0].period;
  assert.equal(runScrutiny({ sources: [books, ais], checkIds: ["AIS02"] }).results[0].status, "insufficient_data");
});

test("missing required source or incomplete source cannot match", () => {
  const missing = runScrutiny({ sources: [], checkIds: ["B01"] }).results[0];
  assert.equal(missing.status, "insufficient_data");
  const bad = source("v", "books_vouchers", [], { status: "insufficient_data", issues: [{ code: "EMPTY_AUDIT_SOURCE" }] });
  assert.equal(runScrutiny({ sources: [bad], checkIds: ["B01"] }).results[0].status, "insufficient_data");
});

test("partial sources run supported checks provisionally while identity conflicts still block", () => {
  const ledger = source("l", "books_ledgers", [{ ledger: "Cash", openingBalance: "10.00",
    debits: "0.00", credits: "0.00", closingBalance: "10.00", provenance: ref("l", 1) }], {
    status: "insufficient_data", completeExport: false,
    issues: [{ code: "AUDIT_EXPORT_COMPLETENESS_UNCONFIRMED", message: "Export completeness unconfirmed." }],
  });
  const [rollForward, dormancy] = runScrutiny({ sources: [ledger], checkIds: ["B02", "B04"] }).results;
  assert.equal(rollForward.status, "review");
  assert.equal(dormancy.status, "review");
  assert(dormancy.evidence.some((row) => row.ledger === "Cash"));
  assert(dormancy.evidence.some((row) => row.kind === "source_limitation"));
  const conflicting = { ...ledger, issues: [...ledger.issues,
    { code: "AUDIT_TAXPAYER_MISMATCH", message: "Different taxpayer." }] };
  assert.equal(runScrutiny({ sources: [conflicting], checkIds: ["B04"] }).results[0].status,
    "insufficient_data");
});

test("X01 retains mapped provisional comparisons when another measure still needs mapping", () => {
  const books = source("books", "books_ledgers", [{ ledger: "Sales", accountRole: "sales",
    entries: [{ side: "credit", amount: "100.00", date: "12-Apr-25", provenance: ref("books", 1) }] }],
  { financialYear: "2025-2026", taxpayerId: "ABCDE1234F", status: "insufficient_data",
    issues: [{ code: "AUDIT_EXPORT_COMPLETENESS_UNCONFIRMED", message: "Completeness unconfirmed." }] });
  const tis = source("tis", "supporting_document", [
    { kind: "category_total", category: "gst_turnover", amount: "100.00", provenance: ref("tis", 1) },
    { kind: "category_total", category: "interest_deposit", amount: "10.00", provenance: ref("tis", 2) },
  ], { documentType: "tis", financialYear: "2025-2026", taxpayerId: "ABCDE1234F",
    status: "insufficient_data",
    issues: [{ code: "AUDIT_EXPORT_COMPLETENESS_UNCONFIRMED", message: "Completeness unconfirmed." }] });
  const queries = source("queries", "supporting_document", [],
    { documentType: "audit_queries", status: "insufficient_data",
      issues: [{ code: "AUDIT_QUERY_EMPTY", message: "No query rows." }] });
  const finding = runScrutiny({ sources: [books, tis, queries], checkIds: ["X01"],
    reportTaxpayerId: "ABCDE1234F" }).results[0];
  assert.equal(finding.status, "review");
  assert(finding.evidence.some((row) => row.accountRole === "sales" && row.actualAmount === "100.00"));
  assert(finding.evidence.some((row) => row.comparison === "mapping_required"));
  assert(finding.evidence.some((row) => row.kind === "source_limitation"));
});
