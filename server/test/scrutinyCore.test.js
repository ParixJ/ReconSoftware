import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseAuditSource, normalizeAuditRows } from "../src/scrutiny/core/parseAuditSource.js";
import { runScrutiny } from "../src/scrutiny/core/runScrutiny.js";
import { fromPaise, toPaise } from "../src/scrutiny/core/money.js";

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
    assert.equal(runScrutiny({ sources: [parsed], checkIds: ["B02"] }).results[0].status, "insufficient_data");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("B01 through B04 compare exact balances and flag review candidates", () => {
  const vouchers = source("v", "books_vouchers", [
    { voucherId: "V1", side: "debit", amount: "10.10", provenance: ref("v", 1) },
    { voucherId: "V1", side: "credit", amount: "10.09", provenance: ref("v", 2) },
  ]);
  const ledgers = source("l", "books_ledgers", [
    { ledger: "Cash", openingBalance: "10.00", debits: "0.10", credits: "0.00", closingBalance: "10.10", provenance: ref("l", 1) },
    { ledger: "Old", openingBalance: "5.00", debits: "0.00", credits: "0.00", closingBalance: "5.00", provenance: ref("l", 2) },
  ]);
  const tb = source("t", "trial_balance", [
    { ledger: "Cash", openingDebit: "10.00", openingCredit: "0.00", closingDebit: "10.10", closingCredit: "0.00", provenance: ref("t", 1) },
    { ledger: "Revenue", openingDebit: "0.00", openingCredit: "10.00", closingDebit: "0.00", closingCredit: "10.09", provenance: ref("t", 2) },
  ]);
  const results = runScrutiny({ sources: [vouchers, ledgers, tb], checkIds: ["B01", "B02", "B03", "B04"] }).results;
  assert.deepEqual(results.map((item) => item.status), ["difference", "matched", "difference", "review"]);
  assert.equal(results[0].evidence[0].differenceAmount, "0.01");
  assert.equal(results[2].evidence[0].differenceAmount, "0.01");
  assert.equal(results[3].evidence[0].ledger, "Old");
  assert.deepEqual(results.map((item) => item.id), ["B01", "B02", "B03", "B04"]);
});

test("P01 compares mapped signed balances and refuses nonconsecutive years", () => {
  const current = source("current", "trial_balance", [{ ledger: "Cash", openingDebit: "10.00", openingCredit: "0.00", closingDebit: "10.00", closingCredit: "0.00", provenance: ref("current", 1) }], { financialYear: "2025-26" });
  const prior = source("prior", "prior_year_trial_balance", [{ ledger: "Cash", openingDebit: "8.00", openingCredit: "0.00", closingDebit: "9.99", closingCredit: "0.00", provenance: ref("prior", 1) }], { financialYear: "2024-25" });
  assert.equal(runScrutiny({ sources: [current, prior], checkIds: ["P01"] }).results[0].evidence[0].differenceAmount, "0.01");
  prior.financialYear = "2023-24";
  assert.equal(runScrutiny({ sources: [current, prior], checkIds: ["P01"] }).results[0].status, "insufficient_data");
});

test("AIS01 compares only explicitly comparable income by taxpayer, category, period and reference", () => {
  const books = normalizeAuditRows({ role: "books_vouchers", sourceId: "b", originalName: "books.json", rows: [
    { rowNumber: 1, row: { voucherId: "V1", ledger: "Interest", side: "Cr", amount: "5.00",
      incomeAmount: "5.00", incomeCategory: "INTEREST", taxpayerId: "ABCDE1234F", period: "2025-04", reference: "R1" } },
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
});

test("missing required source or incomplete source cannot match", () => {
  const missing = runScrutiny({ sources: [], checkIds: ["B01"] }).results[0];
  assert.equal(missing.status, "insufficient_data");
  const bad = source("v", "books_vouchers", [], { status: "insufficient_data", issues: [{ code: "EMPTY_AUDIT_SOURCE" }] });
  assert.equal(runScrutiny({ sources: [bad], checkIds: ["B01"] }).results[0].status, "insufficient_data");
});
