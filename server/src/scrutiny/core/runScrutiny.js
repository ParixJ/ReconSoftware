import { fromPaise, toPaise } from "./money.js";

export const AUDIT_CHECK_IDS = Object.freeze(["B01", "B02", "B03", "B04", "P01", "AIS01"]);
const COMPARABLE_AIS_CATEGORIES = new Set([
  "INTEREST", "DIVIDEND", "RENT", "BUSINESS_RECEIPTS", "OTHER_INCOME",
]);

function result(checkId, status, summary, evidence = []) {
  return { id: checkId, checkId, status, summary, evidence };
}

function insufficient(checkId, message, evidence = []) {
  return result(checkId, "insufficient_data", message, evidence);
}

function references(records) {
  return records.map((record) => record.provenance).filter(Boolean);
}

function selectedSources(sources, roles, checkId) {
  const chosen = roles.flatMap((role) => sources.filter((source) => source.role === role));
  const missing = roles.filter((role) => !chosen.some((source) => source.role === role));
  if (missing.length) return { error: insufficient(checkId, `Required source role missing: ${missing.join(", ")}.`) };
  const bad = chosen.filter((source) => source.status !== "ready" || !Array.isArray(source.records) || !source.records.length);
  if (bad.length) return { error: insufficient(checkId, "At least one selected source is incomplete or could not be normalized.", bad.map((source) => ({
    sourceId: source.sourceId, issues: source.issues || [],
  }))) };
  return { chosen };
}

function byRole(chosen, role) {
  return chosen.filter((source) => source.role === role);
}

function sum(records, field) {
  return records.reduce((total, record) => total + toPaise(record[field]), 0n);
}

function compareVoucherBalance(sources) {
  const checkId = "B01";
  const selection = selectedSources(sources, ["books_vouchers"], checkId);
  if (selection.error) return selection.error;
  const groups = new Map();
  for (const source of selection.chosen) {
    for (const record of source.records) {
      const key = `${source.sourceId}\0${record.voucherId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    }
  }
  const evidence = [];
  for (const records of groups.values()) {
    const debit = sum(records.filter((record) => record.side === "debit"), "amount");
    const credit = sum(records.filter((record) => record.side === "credit"), "amount");
    if (debit !== credit) evidence.push({ voucherId: records[0].voucherId, sourceId: records[0].provenance?.sourceId,
      debitAmount: fromPaise(debit), creditAmount: fromPaise(credit), differenceAmount: fromPaise(debit - credit),
      sourceRefs: references(records) });
  }
  return result(checkId, evidence.length ? "difference" : "matched",
    evidence.length ? `${evidence.length} voucher(s) do not balance.` : `${groups.size} voucher(s) balance.`, evidence);
}

function compareLedgerRollForward(sources) {
  const checkId = "B02";
  const selection = selectedSources(sources, ["books_ledgers"], checkId);
  if (selection.error) return selection.error;
  const evidence = [];
  let count = 0;
  for (const source of selection.chosen) {
    const names = new Set();
    for (const record of source.records) {
      const ledgerKey = record.ledger.toUpperCase();
      if (names.has(ledgerKey)) return insufficient(checkId, "A ledger appears more than once in one source; its roll-forward is ambiguous.", [{ sourceId: source.sourceId, ledger: record.ledger }]);
      names.add(ledgerKey);
      count += 1;
      const expected = toPaise(record.openingBalance) + toPaise(record.debits) - toPaise(record.credits);
      const actual = toPaise(record.closingBalance);
      if (expected !== actual) evidence.push({ ledger: record.ledger, expectedAmount: fromPaise(expected),
        actualAmount: fromPaise(actual), differenceAmount: fromPaise(actual - expected), sourceRefs: references([record]) });
    }
  }
  return result(checkId, evidence.length ? "difference" : "matched",
    evidence.length ? `${evidence.length} ledger roll-forward(s) differ.` : `${count} ledger roll-forward(s) agree.`, evidence);
}

function compareTrialBalance(sources) {
  const checkId = "B03";
  const selection = selectedSources(sources, ["trial_balance"], checkId);
  if (selection.error) return selection.error;
  const evidence = [];
  for (const source of selection.chosen) {
    const openingDebit = sum(source.records, "openingDebit");
    const openingCredit = sum(source.records, "openingCredit");
    const closingDebit = sum(source.records, "closingDebit");
    const closingCredit = sum(source.records, "closingCredit");
    for (const [period, debit, credit] of [["opening", openingDebit, openingCredit], ["closing", closingDebit, closingCredit]]) {
      if (debit !== credit) evidence.push({ sourceId: source.sourceId, period,
        debitAmount: fromPaise(debit), creditAmount: fromPaise(credit), differenceAmount: fromPaise(debit - credit),
        sourceRefs: references(source.records) });
    }
  }
  return result(checkId, evidence.length ? "difference" : "matched",
    evidence.length ? `${evidence.length} trial-balance control(s) differ.` : "Opening and closing trial-balance controls agree.", evidence);
}

function reviewDormantBalances(sources) {
  const checkId = "B04";
  const selection = selectedSources(sources, ["books_ledgers"], checkId);
  if (selection.error) return selection.error;
  const evidence = [];
  for (const source of selection.chosen) {
    for (const record of source.records) {
      if (toPaise(record.debits) === 0n && toPaise(record.credits) === 0n && toPaise(record.closingBalance) !== 0n) {
        evidence.push({ ledger: record.ledger, closingAmount: record.closingBalance, sourceRefs: references([record]) });
      }
    }
  }
  return result(checkId, evidence.length ? "review" : "matched",
    evidence.length ? `${evidence.length} nonzero ledger balance(s) have no movement in this period; review for dormancy.` :
      "No nonzero, no-movement balance candidates were found.", evidence);
}

function fiscalStart(value) {
  const match = String(value || "").match(/(?:FY\s*)?(\d{4})\s*[-/]\s*(?:\d{2}|\d{4})/i);
  return match ? Number(match[1]) : null;
}

function signedBalance(record, prefix) {
  return toPaise(record[`${prefix}Debit`]) - toPaise(record[`${prefix}Credit`]);
}

function comparePriorYear(sources) {
  const checkId = "P01";
  const selection = selectedSources(sources, ["trial_balance", "prior_year_trial_balance"], checkId);
  if (selection.error) return selection.error;
  const currentSources = byRole(selection.chosen, "trial_balance");
  const priorSources = byRole(selection.chosen, "prior_year_trial_balance");
  if (currentSources.length !== 1 || priorSources.length !== 1) return insufficient(checkId,
    "Select exactly one current and one prior-year trial balance for this comparison.");
  const [current] = currentSources;
  const [prior] = priorSources;
  const currentYear = fiscalStart(current.financialYear);
  const priorYear = fiscalStart(prior.financialYear);
  if (currentYear !== null && priorYear !== null && currentYear !== priorYear + 1) return insufficient(checkId,
    "Selected trial balances do not describe consecutive financial years.");
  if (current.taxpayerId && prior.taxpayerId && current.taxpayerId !== prior.taxpayerId) return insufficient(checkId,
    "Selected trial balances identify different taxpayers.");
  const map = (source) => {
    const records = new Map();
    for (const record of source.records) {
      const key = record.ledger.trim().toUpperCase();
      if (records.has(key)) return null;
      records.set(key, record);
    }
    return records;
  };
  const currentRows = map(current);
  const priorRows = map(prior);
  if (!currentRows || !priorRows) return insufficient(checkId, "Duplicate ledger names prevent unambiguous prior-year mapping.");
  const evidence = [];
  for (const key of new Set([...currentRows.keys(), ...priorRows.keys()])) {
    const currentRecord = currentRows.get(key);
    const priorRecord = priorRows.get(key);
    if (!currentRecord || !priorRecord) {
      evidence.push({ ledger: currentRecord?.ledger || priorRecord?.ledger, reason: "Ledger missing from one year",
        sourceRefs: references([currentRecord, priorRecord].filter(Boolean)) });
      continue;
    }
    const expected = signedBalance(priorRecord, "closing");
    const actual = signedBalance(currentRecord, "opening");
    if (expected !== actual) evidence.push({ ledger: currentRecord.ledger, expectedAmount: fromPaise(expected),
      actualAmount: fromPaise(actual), differenceAmount: fromPaise(actual - expected),
      sourceRefs: references([priorRecord, currentRecord]) });
  }
  return result(checkId, evidence.length ? "difference" : "matched",
    evidence.length ? `${evidence.length} prior-year closing/current opening ledger comparison(s) differ.` :
      `${currentRows.size} prior-year closing balance(s) agree with current openings.`, evidence);
}

function comparisonKey(record, categoryField) {
  return [record.taxpayerId.toUpperCase(), record[categoryField].toUpperCase(),
    record.period.toUpperCase(), record.reference.replace(/\s+/g, " ").trim().toUpperCase()].join("\0");
}

function compareAisIncome(sources) {
  const checkId = "AIS01";
  const selection = selectedSources(sources, ["ais", "books_vouchers"], checkId);
  if (selection.error) return selection.error;
  const ais = byRole(selection.chosen, "ais").flatMap((source) => source.records);
  const comparableAis = ais.filter((record) => COMPARABLE_AIS_CATEGORIES.has(record.category));
  const books = byRole(selection.chosen, "books_vouchers").flatMap((source) => source.records)
    .filter((record) => record.incomeAmount !== undefined && COMPARABLE_AIS_CATEGORIES.has(record.incomeCategory));
  if (!comparableAis.length || !books.length) return insufficient(checkId,
    "Comparable AIS income and explicitly tagged book-income records are both required.", [{
      excludedAisRecords: ais.length - comparableAis.length, taggedBookRecords: books.length,
    }]);
  const map = (records, categoryField, amountField) => {
    const groups = new Map();
    for (const record of records) {
      const key = comparisonKey(record, categoryField);
      const group = groups.get(key) || { amount: 0n, records: [], taxpayerId: record.taxpayerId,
        category: record[categoryField], period: record.period, reference: record.reference };
      group.amount += toPaise(record[amountField]);
      group.records.push(record);
      groups.set(key, group);
    }
    return groups;
  };
  const aisGroups = map(comparableAis, "category", "amount");
  const bookGroups = map(books, "incomeCategory", "incomeAmount");
  const evidence = [];
  for (const key of new Set([...aisGroups.keys(), ...bookGroups.keys()])) {
    const aisGroup = aisGroups.get(key);
    const bookGroup = bookGroups.get(key);
    const actual = aisGroup?.amount ?? 0n;
    const expected = bookGroup?.amount ?? 0n;
    if (actual !== expected || !aisGroup || !bookGroup) {
      const label = aisGroup || bookGroup;
      evidence.push({ taxpayerId: label.taxpayerId, category: label.category, period: label.period,
        reference: label.reference, reason: !aisGroup ? "Missing from AIS" : !bookGroup ? "Missing from books" : "Amount differs",
        expectedAmount: fromPaise(expected), actualAmount: fromPaise(actual), differenceAmount: fromPaise(actual - expected),
        sourceRefs: references([...(bookGroup?.records || []), ...(aisGroup?.records || [])]) });
    }
  }
  const excluded = ais.length - comparableAis.length;
  return result(checkId, evidence.length ? "difference" : "matched",
    `${evidence.length} comparable AIS/book-income difference(s); ${excluded} non-comparable AIS record(s) excluded.`, evidence);
}

const CHECKS = {
  B01: compareVoucherBalance,
  B02: compareLedgerRollForward,
  B03: compareTrialBalance,
  B04: reviewDormantBalances,
  P01: comparePriorYear,
  AIS01: compareAisIncome,
};

export function runScrutiny({ sources, checkIds = AUDIT_CHECK_IDS }) {
  if (!Array.isArray(sources) || !Array.isArray(checkIds)) throw new TypeError("sources and checkIds must be arrays.");
  const unknown = checkIds.find((checkId) => !CHECKS[checkId]);
  if (unknown) throw new TypeError(`Unsupported scrutiny check: ${unknown}`);
  const sourceIds = sources.map((source) => source.sourceId);
  if (sourceIds.some((id) => !id) || new Set(sourceIds).size !== sourceIds.length) {
    return { results: checkIds.map((checkId) => insufficient(checkId, "Source IDs are missing or duplicated.")) };
  }
  return { results: [...new Set(checkIds)].map((checkId) => CHECKS[checkId](sources)) };
}
