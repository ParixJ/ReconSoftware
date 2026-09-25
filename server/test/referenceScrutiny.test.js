import assert from "node:assert/strict";
import test from "node:test";
import { runScrutiny } from "../src/scrutiny/core/runScrutiny.js";

const provenance = (sourceId, rowNumber) => ({ sourceId, originalName: `${sourceId}.csv`, rowNumber });
const source = (sourceId, role, records, extra = {}) => ({ sourceId, role, status: "ready",
  completeExport: true, financialYear: "2025-2026", records, ...extra });
const checks = (sources, checkIds) => new Map(runScrutiny({ sources, checkIds }).results.map((item) => [item.checkId, item]));
const checksWithParameters = (sources, checkIds, parameters) =>
  new Map(runScrutiny({ sources, checkIds, parameters }).results.map((item) => [item.checkId, item]));

test("reference-ledger candidates retain exact source evidence without asserting a legal conclusion", () => {
  const books = source("books", "books_ledgers", [
    { ledger: "Suspense Account", closingBalance: "125.50", provenance: provenance("books", 1) },
    { ledger: "Sundry Debtors", group: "Sundry Debtors", closingBalance: "-210.00", provenance: provenance("books", 2) },
    { ledger: "Input CGST", closingBalance: "400.00", provenance: provenance("books", 3) },
    { ledger: "Insurance Premium", debits: "900.00", closingBalance: "0.00", provenance: provenance("books", 4) },
    { ledger: "Prepaid Insurance", openingBalance: "800.00", closingBalance: "800.00", provenance: provenance("books", 5) },
  ]);
  const found = checks([books], ["B06", "B07", "B09", "B10", "B11"]);
  for (const id of ["B06", "B07", "B09", "B10", "B11"]) assert.equal(found.get(id).status, "review", id);
  assert.equal(found.get("B06").evidence[0].closingAmount, "125.50");
  assert.equal(found.get("B07").evidence[0].reason, "Debtor has a credit balance");
  assert.equal(found.get("B09").evidence[0].ledger, "Input CGST");
  assert.equal(found.get("B10").evidence.filter((row) => row.comparison === "expense_candidate").length, 1);
  assert.equal(found.get("B11").evidence[0].comparison, "possible_missing_reversal");
  assert.deepEqual(found.get("B06").evidence[0].sourceRefs, [provenance("books", 1)]);
});

test("duplicate check distinguishes separate voucher identities from split lines of one voucher", () => {
  const books = source("books", "books_ledgers", [{ ledger: "Repairs", entries: [
    { date: "01-Apr-25", voucherId: "J1", side: "debit", amount: "25000.00", provenance: provenance("books", 2) },
    { date: "01-Apr-25", voucherId: "J1", side: "debit", amount: "25000.00", provenance: provenance("books", 3) },
    { date: "01-Apr-25", voucherId: "J2", side: "debit", amount: "25000.00", provenance: provenance("books", 4) },
    { date: "31-Feb-25", voucherId: "J3", side: "debit", amount: "25000.00", provenance: provenance("books", 5) },
  ] }]);
  const result = checks([books], ["B08"]).get("B08");
  assert.equal(result.status, "review");
  assert.equal(result.evidence.length, 1);
  assert.deepEqual(result.evidence[0].voucherIds, ["J1", "J2"]);
  assert.match(result.summary, /1 posting\(s\) lack/);
  assert.equal(checks([source("same", "books_ledgers", [{ ledger: "Repairs", entries: books.records[0].entries.slice(0, 2) }])],
    ["B08"]).get("B08").status, "matched");
});

test("duplicate voucher materiality is configurable per run", () => {
  const books = source("books", "books_ledgers", [{ ledger: "Repairs", entries: [
    { date: "01-Apr-25", voucherId: "J1", side: "debit", amount: "250.00", provenance: provenance("books", 2) },
    { date: "01-Apr-25", voucherId: "J2", side: "debit", amount: "250.00", provenance: provenance("books", 3) },
  ] }]);
  assert.equal(checks([books], ["B08"]).get("B08").evidence.length, 0);
  const result = checksWithParameters([books], ["B08"], { duplicateVoucherMinAmount: "100.00" }).get("B08");
  assert.equal(result.evidence.length, 1);
  assert.match(result.summary, /above 100\.00/);
});

test("YoY compares balance magnitudes and does not inflate a sign-convention change", () => {
  const prior = source("prior", "prior_year_trial_balance", [
    { ledger: "Loan", closingDebit: "0.00", closingCredit: "200.00", provenance: provenance("prior", 1) },
    { ledger: "Plant", closingDebit: "100.00", closingCredit: "0.00", provenance: provenance("prior", 2) },
    { ledger: "Old Expense", closingDebit: "50.00", closingCredit: "0.00", provenance: provenance("prior", 3) },
  ], { financialYear: "2024-2025", taxpayerId: "ABCDE1234F" });
  const current = source("current", "trial_balance", [
    { ledger: "Loan", closingDebit: "200.00", closingCredit: "0.00", provenance: provenance("current", 1) },
    { ledger: "Plant", closingDebit: "160.00", closingCredit: "0.00", provenance: provenance("current", 2) },
    { ledger: "New Expense", closingDebit: "20.00", closingCredit: "0.00", provenance: provenance("current", 3) },
  ], { taxpayerId: "ABCDE1234F" });
  const result = checks([prior, current], ["P02"]).get("P02");
  assert.equal(result.status, "difference");
  assert.deepEqual(result.evidence.find((row) => row.ledger === "Loan"), {
    ledger: "Loan", comparison: "matched_sign_convention", priorAmount: "-200.00",
    currentAmount: "200.00", differenceAmount: "0.00", percentageChange: "0.00",
    sourceRefs: [provenance("prior", 1), provenance("current", 1)],
  });
  assert.equal(result.evidence.find((row) => row.ledger === "Plant").comparison, "significant_change");
  assert.equal(result.evidence.find((row) => row.ledger === "Plant").differenceAmount, "60.00");
  assert.equal(result.evidence.filter((row) => row.comparison.includes("_year")).length, 2);
  assert.equal(checks([prior, { ...current, taxpayerId: "PQRST1234F" }], ["P02"]).get("P02").status,
    "insufficient_data");
});

test("missing explicit balances are not invented to make reference-style checks appear matched", () => {
  const books = source("books", "books_ledgers", [
    { ledger: "Prepaid Insurance", debits: "20.00" },
    { ledger: "Suspense Account", debits: "5.00" },
  ]);
  const found = checks([books], ["B06", "B11"]);
  assert.equal(found.get("B06").status, "insufficient_data");
  assert.equal(found.get("B11").status, "insufficient_data");
});

test("name-based checks do not pass when no ledger can be classified", () => {
  const books = source("books", "books_ledgers", [
    { ledger: "General Expense", closingBalance: "0.00", provenance: provenance("books", 1) },
  ]);
  const found = checks([books], ["B06", "B07", "B09"]);
  for (const id of ["B06", "B07", "B09"]) {
    assert.equal(found.get(id).status, "insufficient_data", id);
    assert.equal(found.get(id).evidence[0].kind, "classification_not_established");
  }
});
