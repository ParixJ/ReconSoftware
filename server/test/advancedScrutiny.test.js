import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseAuditSource } from "../src/scrutiny/core/parseAuditSource.js";
import { runScrutiny } from "../src/scrutiny/core/runScrutiny.js";

const provenance = (sourceId, rowNumber) => ({ sourceId, originalName: `${sourceId}.json`, rowNumber });
const source = (sourceId, role, records, extra = {}) => ({ sourceId, role, status: "ready",
  completeExport: true, financialYear: "2025-2026", records, ...extra });
const support = (sourceId, documentType, records, extra = {}) =>
  source(sourceId, "supporting_document", records, { documentType, ...extra });
const resultMap = (sources, checkIds) =>
  new Map(runScrutiny({ sources, checkIds, reportTaxpayerId: "ABCDE1234F" }).results
    .map((item) => [item.checkId, item]));

test("structured supporting JSON can be uploaded with an explicit document type", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scrutiny-support-"));
  try {
    const filePath = path.join(dir, "msme.json");
    await fs.writeFile(filePath, JSON.stringify({ completeExport: true,
      records: [{ Supplier: "Vendor A", InvoiceDate: "2025-04-01", PaymentDate: "2025-05-31",
        InvoiceAmount: "1000.00", MSME: "yes" }] }));
    const parsed = await parseAuditSource({ filePath, originalName: "msme.json",
      role: "supporting_document", sourceId: "msme", completeExport: true,
      documentType: "msme_register" });
    assert.equal(parsed.status, "ready");
    assert.equal(parsed.documentType, "msme_register");
    assert.equal(parsed.records[0].supplier, "Vendor A");
    const finding = resultMap([parsed], ["M01"]).get("M01");
    assert.equal(finding.status, "review");
    assert.equal(finding.evidence[0].comparison, "paid_after_msme_due_date");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("advanced scrutiny modules produce reviewer-safe findings from structured evidence", () => {
  const booksLedgers = source("books-ledgers", "books_ledgers", [
    { ledger: "Bank of India", accountRole: "bank", entries: [
      { side: "debit", amount: "500.00", provenance: provenance("books-ledgers", 1) },
      { side: "credit", amount: "200.00", provenance: provenance("books-ledgers", 2) },
    ] },
    { ledger: "Term Loan - Bank", accountRole: "loan", closingBalance: "950.00",
      provenance: provenance("books-ledgers", 3) },
    { ledger: "GST Cash IGST", accountRole: "gst_cash_igst", entries: [
      { side: "debit", amount: "100.00", provenance: provenance("books-ledgers", 4) },
      { side: "credit", amount: "25.00", provenance: provenance("books-ledgers", 5) },
    ] },
    { ledger: "Professional Fees", accountRole: "professional_fees", entries: [
      { side: "debit", amount: "50000.00", counterparty: "Advisor", provenance: provenance("books-ledgers", 6) },
    ] },
    { ledger: "TDS Payable", accountRole: "tds_payable", entries: [
      { side: "credit", amount: "1000.00", section: "194J", provenance: provenance("books-ledgers", 7) },
    ] },
    { ledger: "Advance Tax", accountRole: "advance_tax", entries: [
      { side: "debit", amount: "10000.00", provenance: provenance("books-ledgers", 8) },
    ] },
  ], { taxpayerId: "ABCDE1234F" });
  const currentTb = source("tb", "trial_balance", [
    { ledger: "Capital", openingDebit: "0.00", openingCredit: "90.00",
      closingDebit: "0.00", closingCredit: "120.00", provenance: provenance("tb", 1) },
  ], { taxpayerId: "ABCDE1234F" });
  const findings = resultMap([
    booksLedgers,
    currentTb,
    support("prior", "prior_year_report", [
      { ledger: "Capital", amount: "-100.00", provenance: provenance("prior", 1) },
      { kind: "related party", label: "Director loan", amount: "25.00", provenance: provenance("prior", 2) },
    ], { financialYear: "2024-2025", taxpayerId: "ABCDE1234F" }),
    support("gst", "gst_cash_ledger", [
      { kind: "transaction", account: "integrated", side: "credit", amount: "100.00", provenance: provenance("gst", 1) },
      { kind: "transaction", account: "integrated", side: "debit", amount: "20.00", provenance: provenance("gst", 2) },
    ], { taxpayerId: "24ABCDE1234F1Z5" }),
    support("stock", "stock_report", [
      { item: "Slow Item", closingQuantity: "10", daysSinceLastMovement: "240", closingValue: "500.00",
        provenance: provenance("stock", 1) },
    ]),
    support("bank", "bank_statement", [
      { depositAmount: "500.00", withdrawalAmount: "210.00", provenance: provenance("bank", 1) },
    ], { taxpayerId: "ABCDE1234F" }),
    support("loan", "loan_schedule", [
      { lender: "Term Loan - Bank", openingBalance: "1000.00", additions: "0.00", repayments: "100.00",
        interest: "50.00", closingBalance: "950.00", provenance: provenance("loan", 1) },
    ], { taxpayerId: "ABCDE1234F" }),
    support("challan", "tax_challan", [
      { type: "advance_tax", amount: "9000.00", provenance: provenance("challan", 1) },
    ], { taxpayerId: "ABCDE1234F" }),
  ], ["PY01", "G03", "S02", "BK01", "L01", "AT01", "TDS01"]);

  assert.equal(findings.get("PY01").status, "difference");
  assert.equal(findings.get("G03").status, "difference");
  assert.equal(findings.get("S02").status, "review");
  assert.equal(findings.get("BK01").status, "review");
  assert.equal(findings.get("L01").status, "matched");
  assert.equal(findings.get("AT01").status, "review");
  assert.equal(findings.get("TDS01").status, "review");
  assert.ok(findings.get("TDS01").evidence.some((row) => row.section === "194J"));
});

test("keyed cross-file comparisons report the exact differing entries", () => {
  const books = source("books", "books_ledgers", [
    { ledger: "Main Bank", accountRole: "bank", entries: [
      { side: "debit", amount: "8000.00", reference: "UTR-1", date: "2025-04-10",
        counterparty: "Customer A", provenance: provenance("books", 1) },
    ] },
    { ledger: "GST Cash IGST", accountRole: "gst_cash_igst", entries: [
      { side: "debit", amount: "90.00", reference: "CPIN-1", date: "2025-04-11",
        provenance: provenance("books", 2) },
    ] },
    { ledger: "Advance Tax", accountRole: "advance_tax", entries: [
      { side: "debit", amount: "6000.00", reference: "CH-1", date: "2025-06-15",
        provenance: provenance("books", 3) },
    ] },
  ], { taxpayerId: "ABCDE1234F" });
  const findings = resultMap([
    books,
    support("bank", "bank_statement", [
      { reference: "UTR-1", transactionDate: "2025-04-10", depositAmount: "10000.00",
        party: "Customer A", provenance: provenance("bank", 1) },
    ], { taxpayerId: "ABCDE1234F" }),
    support("gst", "gst_cash_ledger", [
      { kind: "transaction", account: "integrated", side: "credit", amount: "100.00",
        reference: "CPIN-1", date: "2025-04-11", provenance: provenance("gst", 1) },
    ], { taxpayerId: "24ABCDE1234F1Z5" }),
    support("challan", "tax_challan", [
      { type: "advance_tax", reference: "CH-1", amount: "5000.00", date: "2025-06-15",
        provenance: provenance("challan", 1) },
    ], { taxpayerId: "ABCDE1234F" }),
  ], ["BK01", "G03", "AT01"]);

  const bank = findings.get("BK01").evidence.find((row) => row.comparisonKey === "UTR-1");
  assert.equal(bank.expectedAmount, "10000.00");
  assert.equal(bank.actualAmount, "8000.00");
  assert.equal(bank.differenceAmount, "-2000.00");
  assert.equal(bank.expectedEntries[0].sourceId, "bank");
  assert.equal(bank.actualEntries[0].sourceId, "books");

  const gst = findings.get("G03").evidence.find((row) => row.comparisonKey === "CPIN-1");
  assert.equal(gst.expectedAmount, "100.00");
  assert.equal(gst.actualAmount, "90.00");
  assert.equal(gst.differenceAmount, "-10.00");

  const challan = findings.get("AT01").evidence.find((row) => row.comparisonKey === "CH-1");
  assert.equal(challan.expectedAmount, "5000.00");
  assert.equal(challan.actualAmount, "6000.00");
  assert.equal(challan.differenceAmount, "1000.00");
});
