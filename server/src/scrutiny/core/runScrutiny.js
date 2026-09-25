import { fromPaise, toPaise } from "./money.js";
import { fromThousandths, toThousandths } from "./stockWorkbook.js";
import { reconcileCrossSources } from "./crossSourceReconciliation.js";
import { hasBlockingSourceIssue, provisionalResult, sourceEligibility } from "./sourceEligibility.js";
import { compareYearOnYear, reviewDuplicateVouchers, reviewInsurancePrepaid,
  reviewPartySign, reviewPendingGst, reviewPrepaidReversal, reviewSuspense } from "./referenceScrutiny.js";

export const AUDIT_CHECK_IDS = Object.freeze(["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08", "B09", "B10", "B11", "B20", "P01", "P02", "AIS01", "AIS02", "A26", "G01", "G02", "S01", "T03", "T09", "X01"]);
const COMPARABLE_AIS_CATEGORIES = new Set([
  "INTEREST", "SAVINGS_INTEREST", "TERM_DEPOSIT_INTEREST", "RECURRING_DEPOSIT_INTEREST",
  "DIVIDEND", "RENT", "BUSINESS_RECEIPTS", "OTHER_INCOME",
]);

export function taxpayerKey(value) {
  const identifier = String(value || "").trim().toUpperCase();
  return identifier.length === 15 ? identifier.slice(2, 12) : identifier;
}

function result(checkId, status, summary, evidence = []) {
  return { id: checkId, checkId, status, summary, evidence };
}

function insufficient(checkId, message, evidence = []) {
  return result(checkId, "insufficient_data", message, evidence);
}

function sourceTaxpayerKeys(source) {
  return [...new Set([
    source?.taxpayerId,
    ...(Array.isArray(source?.records) ? source.records.map((record) => record.taxpayerId) : []),
  ].filter(Boolean).map(taxpayerKey).filter(Boolean))];
}

function identityGate(checkId, sources, reportTaxpayerId = null) {
  if (sources.length <= 1) return null;
  const reportKey = reportTaxpayerId ? taxpayerKey(reportTaxpayerId) : null;
  const evidence = sources.map((source) => ({ sourceId: source.sourceId,
    taxpayerIds: sourceTaxpayerKeys(source) }));
  const ambiguous = evidence.filter((item) => item.taxpayerIds.length > 1);
  if (ambiguous.length) return insufficient(checkId,
    "A selected source contains multiple taxpayer identities; split or remap the source before cross-source comparison.",
    ambiguous);
  const known = [...new Set(evidence.flatMap((item) => item.taxpayerIds))];
  if (known.length > 1) return insufficient(checkId,
    "Selected sources identify different taxpayers and cannot be compared safely.", evidence);
  if (reportKey && known.length && known[0] !== reportKey) return insufficient(checkId,
    "Selected sources identify a taxpayer different from the audit report.", evidence);
  const missing = evidence.filter((item) => item.taxpayerIds.length === 0);
  if (!reportKey && missing.length) return insufficient(checkId,
    "Cross-source comparison requires taxpayer identity on every selected source or on the audit report.", evidence);
  if (!reportKey && known.length === 0) return insufficient(checkId,
    "Cross-source comparison requires an established taxpayer identity.", evidence);
  return null;
}

function references(records) {
  return records.map((record) => record.provenance).filter(Boolean);
}

function selectedSources(sources, roles, checkId) {
  const chosen = roles.flatMap((role) => sources.filter((source) => source.role === role));
  const missing = roles.filter((role) => !chosen.some((source) => source.role === role));
  if (missing.length) return { error: insufficient(checkId, `Required source role missing: ${missing.join(", ")}.`) };
  const bad = chosen.filter((source) => sourceEligibility(source) === "unusable");
  if (bad.length) return { error: insufficient(checkId, "At least one selected source is incomplete or could not be normalized.", bad.map((source) => ({
    sourceId: source.sourceId, issues: source.issues || [],
  }))) };
  if (["B02", "B03", "B04", "B05"].includes(checkId)) {
    const legacy = chosen.filter((source) => source.issues?.some((issue) => issue.code === "AUDIT_LEGACY_BALANCE_INFERENCE"));
    if (legacy.length) return { error: insufficient(checkId,
      "A legacy ledger source may contain inferred zero balances. Derive a corrected source before balance-based scrutiny.",
      legacy.map((source) => ({ sourceId: source.sourceId, issues: source.issues }))) };
  }
  return { chosen };
}

const usable = (source) => sourceEligibility(source) !== "unusable";

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
  let ambiguousVoucherIds = 0;
  let unbalanced = 0;
  for (const records of groups.values()) {
    const identities = new Set(records.map((record) =>
      `${record.date || ""}\0${record.voucherType || ""}`));
    if (identities.size > 1) {
      ambiguousVoucherIds += 1;
      evidence.push({ voucherId: records[0].voucherId,
        sourceId: records[0].provenance?.sourceId, comparison: "ambiguous_duplicate_voucher",
        sourceRefs: references(records) });
      continue;
    }
    const debit = sum(records.filter((record) => record.side === "debit"), "amount");
    const credit = sum(records.filter((record) => record.side === "credit"), "amount");
    if (debit !== credit) {
      unbalanced += 1;
      evidence.push({ voucherId: records[0].voucherId, sourceId: records[0].provenance?.sourceId,
      debitAmount: fromPaise(debit), creditAmount: fromPaise(credit), differenceAmount: fromPaise(debit - credit),
      sourceRefs: references(records) });
    }
  }
  return result(checkId, unbalanced ? "difference" : ambiguousVoucherIds ? "review" : "matched",
    unbalanced || ambiguousVoucherIds ? `${unbalanced} voucher(s) do not balance; ` +
      `${ambiguousVoucherIds} voucher ID(s) span multiple dates or types and require review.` :
      `${groups.size} voucher(s) balance.`, evidence);
}

function compareLedgerRollForward(sources) {
  const checkId = "B02";
  const selection = selectedSources(sources, ["books_ledgers"], checkId);
  if (selection.error) return selection.error;
  const evidence = [];
  const missingControls = [];
  let count = 0;
  for (const source of selection.chosen) {
    const names = new Set();
    for (const record of source.records) {
      const ledgerKey = record.ledger.toUpperCase();
      if (names.has(ledgerKey)) return insufficient(checkId, "A ledger appears more than once in one source; its roll-forward is ambiguous.", [{ sourceId: source.sourceId, ledger: record.ledger }]);
      names.add(ledgerKey);
      count += 1;
      if (["openingBalance", "debits", "credits", "closingBalance"]
        .some((field) => record[field] === undefined || record[field] === null)) {
        missingControls.push({ ledger: record.ledger, sourceRefs: references([record]) });
        continue;
      }
      const expected = toPaise(record.openingBalance) + toPaise(record.debits) - toPaise(record.credits);
      const actual = toPaise(record.closingBalance);
      if (expected !== actual) evidence.push({ ledger: record.ledger, expectedAmount: fromPaise(expected),
        actualAmount: fromPaise(actual), differenceAmount: fromPaise(actual - expected), sourceRefs: references([record]) });
    }
  }
  if (missingControls.length) return result(checkId,
    count > missingControls.length ? "review" : "insufficient_data",
    `${count - missingControls.length} ledger roll-forward(s) assessed; ` +
      `${evidence.length} differ among readable controls; ` +
      `${missingControls.length} ledger(s) lack explicit balances or movements. No zero balance was inferred.`,
    [...evidence, ...missingControls.map((item) => ({ ...item, kind: "unassessable_ledger" }))]);
  return result(checkId, evidence.length ? "difference" : "matched",
    evidence.length ? `${evidence.length} ledger roll-forward(s) differ.` : `${count} ledger roll-forward(s) agree.`, evidence);
}

function compareTrialBalance(sources) {
  const checkId = "B03";
  const selection = selectedSources(sources, ["books_ledgers", "trial_balance"], checkId);
  if (selection.error) return selection.error;
  const ledgerSources = byRole(selection.chosen, "books_ledgers");
  const trialSources = byRole(selection.chosen, "trial_balance");
  if (ledgerSources.length !== 1 || trialSources.length !== 1) return insufficient(checkId,
    "Select exactly one complete ledger export and one current trial balance.");
  const evidence = [];
  for (const source of trialSources) {
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
  const ledgerRows = new Map();
  for (const row of ledgerSources[0].records) {
    const key = row.ledger.trim().toUpperCase();
    if (ledgerRows.has(key)) return insufficient(checkId, "Duplicate ledger names prevent trial-balance mapping.");
    ledgerRows.set(key, row);
  }
  const trialRows = new Map();
  for (const row of trialSources[0].records) {
    const key = row.ledger.trim().toUpperCase();
    if (trialRows.has(key)) return insufficient(checkId, "Duplicate trial-balance ledgers prevent mapping.");
    trialRows.set(key, row);
  }
  for (const key of new Set([...ledgerRows.keys(), ...trialRows.keys()])) {
    const ledger = ledgerRows.get(key);
    const trial = trialRows.get(key);
    if (!ledger || !trial) {
      evidence.push({ ledger: ledger?.ledger || trial?.ledger, reason: "Ledger missing from one source",
        sourceRefs: references([ledger, trial].filter(Boolean)) });
      continue;
    }
    if (ledger.closingBalance === undefined || ledger.closingBalance === null) return insufficient(checkId,
      `Ledger ${ledger.ledger} has no explicit closing balance for the trial-balance comparison.`, evidence);
    const expected = toPaise(ledger.closingBalance);
    const actual = signedBalance(trial, "closing");
    if (expected !== actual) evidence.push({ ledger: ledger.ledger,
      expectedAmount: fromPaise(expected), actualAmount: fromPaise(actual),
      differenceAmount: fromPaise(actual - expected), sourceRefs: references([ledger, trial]) });
  }
  return result(checkId, evidence.length ? "difference" : "matched",
    evidence.length ? `${evidence.length} trial-balance control or ledger comparison(s) differ.` :
      "Opening and closing controls and ledger closings agree with the trial balance.", evidence);
}

function reviewDormantBalances(sources) {
  const checkId = "B04";
  const selection = selectedSources(sources, ["books_ledgers"], checkId);
  if (selection.error) return selection.error;
  const evidence = [];
  const missingClosings = [];
  let assessed = 0;
  for (const source of selection.chosen) {
    for (const record of source.records) {
      if (record.closingBalance === undefined || record.closingBalance === null ||
          record.debits === undefined || record.credits === undefined) {
        missingClosings.push({ kind: "unassessable_ledger", ledger: record.ledger,
          sourceRefs: references([record]) });
        continue;
      }
      assessed += 1;
      if (toPaise(record.debits) === 0n && toPaise(record.credits) === 0n && toPaise(record.closingBalance) !== 0n) {
        evidence.push({ ledger: record.ledger, closingAmount: record.closingBalance, sourceRefs: references([record]) });
      }
    }
  }
  if (missingClosings.length) return result(checkId, assessed ? "review" : "insufficient_data",
    `${assessed} ledger(s) assessed with ${evidence.length} dormant balance candidate(s); ` +
      `${missingClosings.length} ledger(s) lack ` +
      "explicit closing balances or movements and remain unassessable.", [...evidence, ...missingClosings]);
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
  return [taxpayerKey(record.taxpayerId), record[categoryField].toUpperCase(),
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
  if ([...comparableAis, ...books].some((record) =>
    !record.taxpayerId || !record.period || !record.reference || record.amount === null ||
    (record.amount === undefined && record.incomeAmount === undefined))) return insufficient(checkId,
    "AIS/book-income records need taxpayer, period, reference and amount before transaction-level comparison; PDF table rows without a stable transaction reference cannot be matched safely.");
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

function reviewNegativeCash(sources) {
  const checkId = "B05";
  const selection = selectedSources(sources, ["books_ledgers"], checkId);
  if (selection.error) return selection.error;
  const cashLedgers = selection.chosen.flatMap((source) => source.records
    .filter((record) => record.accountRole === "cash").map((record) => ({ source, record })));
  if (!cashLedgers.length) return insufficient(checkId,
    "No ledger is auditor-mapped to the cash account role; a cash balance cannot be inferred from its name.");
  const evidence = [];
  const missing = [];
  const dayKey = (value) => {
    const text = String(value || "");
    const iso = /^(20\d{2})-?(\d{2})-?(\d{2})$/.exec(text);
    const dmy = /^(\d{1,2})[-\/]([A-Za-z]{3}|\d{1,2})[-\/](\d{2}|\d{4})$/.exec(text);
    if (!iso && !dmy) return null;
    const month = iso ? Number(iso[2]) : /^\d+$/.test(dmy[2]) ? Number(dmy[2]) :
      ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
        .indexOf(dmy[2].toUpperCase()) + 1;
    const year = iso ? Number(iso[1]) : Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const day = iso ? Number(iso[3]) : Number(dmy[1]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
    return date.toISOString().slice(0, 10);
  };
  for (const { source, record } of cashLedgers) {
    if (record.openingBalance === undefined || !Array.isArray(record.entries) ||
        record.entries.some((entry) => !dayKey(entry.date))) {
      missing.push({ ledger: record.ledger, sourceId: source.sourceId, sourceRefs: references([record]) });
      continue;
    }
    let balance = toPaise(record.openingBalance);
    if (balance < 0n) evidence.push({ ledger: record.ledger, date: "opening", balance: fromPaise(balance),
      sourceRefs: references([record]) });
    const entries = record.entries.map((entry, index) => ({ entry, index, date: dayKey(entry.date) }))
      .sort((left, right) => left.date.localeCompare(right.date) || left.index - right.index);
    for (const { entry, index, date } of entries) {
      balance += (entry.side === "debit" ? 1n : -1n) * toPaise(entry.amount);
      if (balance < 0n) evidence.push({ ledger: record.ledger, date,
        transactionIndex: index + 1, side: entry.side, amount: entry.amount,
        balance: fromPaise(balance), sourceRefs: references([entry]) });
    }
    if (record.closingBalance !== undefined && toPaise(record.closingBalance) !== balance) {
      missing.push({ ledger: record.ledger, sourceId: source.sourceId,
        reason: "Closing control disagrees with the opening and dated movements.", sourceRefs: references([record]) });
    }
  }
  if (missing.length) return insufficient(checkId,
    `${missing.length} mapped cash ledger(s) lack valid controls/dates or do not roll forward.`,
    [...evidence, ...missing]);
  return result(checkId, evidence.length ? "review" : "matched",
    evidence.length ? `${evidence.length} negative cash balance point(s) need review.` :
      `${cashLedgers.length} mapped cash ledger(s) have no negative running balance.`, evidence);
}

function compareBookExportCoverage(sources) {
  const checkId = "B20";
  const vouchers = sources.filter((source) => source.role === "books_vouchers");
  const statements = sources.filter((source) => source.role === "books_ledgers");
  if (vouchers.length !== 1 || statements.length !== 1 ||
      !usable(vouchers[0]) || !usable(statements[0])) return insufficient(checkId,
    "Select one complete voucher export and one complete ledger-statement export for cross-source comparison.");
  if (vouchers[0].financialYear !== statements[0].financialYear) return insufficient(checkId,
    "Book voucher and ledger-statement exports cover different financial years.");
  const keyOf = (name) => String(name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const postingGroups = new Map();
  for (const record of vouchers[0].records) {
    const key = keyOf(record.ledger);
    const group = postingGroups.get(key) || { ledger: record.ledger, debit: 0n, credit: 0n, records: [] };
    group[record.side] += toPaise(record.amount);
    group.records.push(record);
    postingGroups.set(key, group);
  }
  const statementGroups = new Map();
  for (const record of statements[0].records) {
    const key = keyOf(record.ledger);
    if (statementGroups.has(key)) return insufficient(checkId,
      "Ledger names collapse to the same comparison key; provide an explicit mapping.");
    statementGroups.set(key, record);
  }
  const evidence = [];
  let mapped = 0;
  let differing = 0;
  for (const [key, statement] of statementGroups) {
    const posting = postingGroups.get(key);
    if (!posting) continue;
    mapped += 1;
    const debitDifference = posting.debit - toPaise(statement.debits);
    const creditDifference = posting.credit - toPaise(statement.credits);
    if (debitDifference || creditDifference) {
      differing += 1;
      evidence.push({ ledger: statement.ledger, voucherDebit: fromPaise(posting.debit),
        statementDebit: statement.debits, voucherCredit: fromPaise(posting.credit),
        statementCredit: statement.credits, debitDifference: fromPaise(debitDifference),
        creditDifference: fromPaise(creditDifference), sourceRefs: references([...posting.records, statement]) });
    }
  }
  const unmapped = statementGroups.size - mapped;
  const unused = postingGroups.size - mapped;
  if (unmapped || unused) evidence.push({ kind: "unmapped_coverage",
    statementSourceId: statements[0].sourceId, voucherSourceId: vouchers[0].sourceId,
    statementLedgers: [...statementGroups].filter(([key]) => !postingGroups.has(key))
      .map(([, record]) => record.ledger),
    voucherLedgers: [...postingGroups].filter(([key]) => !statementGroups.has(key))
      .map(([, group]) => group.ledger) });
  const summary = `${mapped}/${statementGroups.size} statement ledgers map to voucher ledgers; ${unmapped} statement and ${unused} voucher ledgers are unmapped; ${differing} mapped ledger movement(s) differ.`;
  if (unmapped || unused) return insufficient(checkId,
    `${summary} Confirm entity/chart-of-accounts identity or supply a ledger crosswalk before claiming a cross-source match.`, evidence);
  return result(checkId, differing ? "difference" : "matched", summary, evidence);
}

function compareAisTurnover(sources) {
  const checkId = "AIS02";
  const ledgerSources = sources.filter((source) => source.role === "books_ledgers" && usable(source));
  const aisSources = sources.filter((source) => source.role === "ais" && source.documentType === "ais");
  const verifiedTurnover = aisSources[0]?.tables?.filter((table) =>
    table.informationCode === "EXC-GSTR3B" && table.status === "verified") || [];
  if (ledgerSources.length === 1 && aisSources.length === 1 && !verifiedTurnover.length &&
      !sources.some((source) => source.role === "books_vouchers" &&
        source.records?.some((record) => record.taxableValue !== undefined))) {
    return insufficient(checkId, "The AIS GST-turnover table is incomplete or unverified; no reliable period comparison is available.",
      [{ sourceId: aisSources[0].sourceId, issues: aisSources[0].issues || [],
        tableStatuses: aisSources[0].tables?.filter((table) => table.informationCode === "EXC-GSTR3B")
          .map((table) => ({ tableId: table.id, status: table.status })) || [] }]);
  }
  if (ledgerSources.length === 1 && aisSources.length === 1 && verifiedTurnover.length === 1) {
    const book = ledgerSources[0];
    const ais = aisSources[0];
    const sales = book.records.filter((record) => record.accountRole === "sales");
    if (sales.length !== 1 || !Array.isArray(sales[0].entries) || !sales[0].entries.length) return insufficient(checkId,
      "One auditor-mapped, dated sales statement is required to compare AIS GST turnover with books.");
    if (book.financialYear !== ais.financialYear || !ais.taxpayerId) return insufficient(checkId,
      "AIS and the sales ledger must cover the same financial year and AIS must identify the taxpayer.");
    const bookMonths = new Map();
    for (const entry of sales[0].entries) {
      const date = /^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/.exec(entry.date || "");
      if (!date) return insufficient(checkId, "A sales-ledger movement has no readable date.",
        [{ sourceRefs: references([entry]) }]);
      const month = new Date(Date.UTC(Number(date[3]), Number(date[2]) - 1, Number(date[1])))
        .toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
      const period = `${month}-${date[3]}`;
      const group = bookMonths.get(period) || { amount: 0n, records: [] };
      group.amount += (entry.side === "credit" ? 1n : -1n) * toPaise(entry.amount);
      group.records.push(entry);
      bookMonths.set(period, group);
    }
    const aisMonths = new Map();
    for (const record of verifiedTurnover[0].rows.filter((row) => row.status === "active")) {
      if (!record.period || !record.taxableValue || aisMonths.has(record.period)) return insufficient(checkId,
        "The verified AIS turnover table has missing or duplicate monthly taxable values.");
      aisMonths.set(record.period, record);
    }
    const evidence = [...new Set([...bookMonths.keys(), ...aisMonths.keys()])].sort().map((period) => {
      const bookGroup = bookMonths.get(period);
      const aisRow = aisMonths.get(period);
      const bookAmount = bookGroup?.amount ?? 0n;
      const aisAmount = aisRow ? toPaise(aisRow.taxableValue) : 0n;
      const difference = aisAmount - bookAmount;
      return { period, aisTaxableValue: fromPaise(aisAmount), booksSalesNet: fromPaise(bookAmount),
        differenceAmount: fromPaise(difference), withinRupeeRounding: difference >= -50n && difference <= 50n,
        reason: !bookGroup ? "Missing sales-ledger month" : !aisRow ? "Missing AIS month" : null,
        sourceRefs: references([...(bookGroup?.records || []), ...(aisRow ? [aisRow] : [])]) };
    });
    const outsideRounding = evidence.filter((row) => !row.withinRupeeRounding || row.reason).length;
    return result(checkId, "review",
      `${evidence.length} AIS GST-turnover months compared with the Sales A/c. (GST) ledger; ${outsideRounding} month(s) differ beyond whole-rupee rounding. Confirm that the ledger belongs to the AIS taxpayer and covers all outward supplies.`, evidence);
  }
  const selection = selectedSources(sources, ["ais", "books_vouchers"], checkId);
  if (selection.error) return selection.error;
  const aisRecords = byRole(selection.chosen, "ais").flatMap((source) => source.records)
    .filter((record) => record.category === "EXC-GSTR3B");
  const booksRecords = byRole(selection.chosen, "books_vouchers").flatMap((source) => source.records)
    .filter((record) => record.taxableValue !== undefined);
  if (!aisRecords.length || !booksRecords.length) return insufficient(checkId,
    "AIS GST-turnover entries and explicitly tagged book taxable values are both required.");
  const taxpayerIds = new Set([...aisRecords, ...booksRecords]
    .map((record) => taxpayerKey(record.taxpayerId)).filter(Boolean));
  if (taxpayerIds.size !== 1 || [...aisRecords, ...booksRecords].some((record) => !record.taxpayerId)) {
    return insufficient(checkId, "The AIS and tagged book values must identify one taxpayer.");
  }
  if ([...aisRecords, ...booksRecords].some((record) => !record.period)) {
    return insufficient(checkId, "The AIS and tagged book values must identify a period.");
  }
  const aisKeys = aisRecords.map((record) => `${record.period}\0${record.reference}`);
  if (new Set(aisKeys).size !== aisKeys.length) return insufficient(checkId,
    "Duplicate AIS GST-turnover entries need review before aggregation.");
  const periods = new Set([...aisRecords, ...booksRecords].map((record) => record.period));
  const evidence = [...periods].sort().map((period) => {
    const aisPeriod = aisRecords.filter((record) => record.period === period);
    const booksPeriod = booksRecords.filter((record) => record.period === period);
    const aisTotal = sum(aisPeriod, "amount");
    const booksTotal = sum(booksPeriod, "taxableValue");
    return { taxpayerId: [...taxpayerIds][0], period, aisAmount: fromPaise(aisTotal),
      booksTaxableValue: fromPaise(booksTotal), differenceAmount: fromPaise(aisTotal - booksTotal),
      sourceRefs: references([...aisPeriod, ...booksPeriod]) };
  });
  const differs = evidence.some((entry) => entry.differenceAmount !== "0.00");
  return result(checkId, differs ? "review" : "matched",
    differs ? "AIS GST turnover differs from tagged book taxable values by period; review timing and tax-basis differences." :
      "AIS GST turnover agrees with explicitly tagged book taxable values by period.", evidence);
}

function supportingSources(sources, type) {
  return sources.filter((source) => source.role === "supporting_document" && source.documentType === type);
}

function compareAisWith26as(sources) {
  const checkId = "A26";
  const ais = sources.filter((source) => source.role === "ais" && source.documentType === "ais");
  const forms = supportingSources(sources, "form_26as");
  if (ais.length !== 1 || forms.length !== 1 || hasBlockingSourceIssue(ais[0]) || !usable(forms[0])) return insufficient(checkId,
    "Select one detected AIS and one complete Form 26AS for the same period.");
  if (!ais[0].taxpayerId || !forms[0].taxpayerId ||
      taxpayerKey(ais[0].taxpayerId) !== taxpayerKey(forms[0].taxpayerId) ||
      ais[0].financialYear !== forms[0].financialYear) return insufficient(checkId,
    "AIS and Form 26AS identify different taxpayers or periods.");
  if (ais[0].tables?.length) {
    const groups = new Map();
    for (const record of forms[0].records.filter((item) => ["194A", "194Q", "206CE"].includes(item.section))) {
      const key = `${record.section}\0${record.tan}`;
      const group = groups.get(key) || { section: record.section, tan: record.tan,
        amount: 0n, records: [] };
      group.amount += toPaise(record.amount);
      group.records.push(record);
      groups.set(key, group);
    }
    const evidence = [];
    const used = new Set();
    for (const table of ais[0].tables.filter((item) => ["194A", "194Q", "206CE"].includes(item.informationCode))) {
      const candidates = [...groups].filter(([key, group]) =>
        !used.has(key) && group.section === table.informationCode);
      const exact = candidates.filter(([, group]) =>
        table.expectedAmount && group.amount === toPaise(table.expectedAmount));
      const linked = exact.length === 1 ? exact[0] : candidates.length === 1 ? candidates[0] : null;
      if (linked) used.add(linked[0]);
      const formAmount = linked ? fromPaise(linked[1].amount) : null;
      evidence.push({ section: table.informationCode, tableId: table.id,
        aisCandidateAmount: table.expectedAmount, form26asAmount: formAmount,
        tableStatus: table.status, activeRows: table.rows.filter((row) => row.status === "active").length,
        comparison: !linked ? "group_unmapped" :
          table.expectedAmount !== formAmount ? "candidate_differs" :
            table.status === "verified" ? "table_agrees" : "candidate_agrees",
        sourceRefs: references([table, ...(linked?.[1].records || [])]) });
    }
    for (const [key, group] of groups) {
      if (used.has(key)) continue;
      evidence.push({ section: group.section, reference: group.tan,
        aisCandidateAmount: null, form26asAmount: fromPaise(group.amount),
        comparison: "not_read_from_ais", sourceRefs: references(group.records) });
    }
    if (!evidence.length) return insufficient(checkId, "No AIS TDS/TCS tables could be linked to Form 26AS.");
    const agreed = evidence.filter((item) => item.comparison === "table_agrees").length;
    return result(checkId, "review",
      `${agreed} verified AIS TDS/TCS table(s) agree with Form 26AS gross amounts; review unverified tables, corrections, and reporting-party identity.`, evidence);
  }
  if (!ais[0].records.some((record) => record.section)) return insufficient(checkId,
    "No AIS TDS/TCS summary candidates were legible enough to cross-check.");
  const aggregate = new Map();
  const partyKey = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  for (const record of forms[0].records) {
    if (!["194A", "194Q", "206CE"].includes(record.section) || !record.tan) continue;
    const key = `${record.section}\0${record.tan}`;
    const group = aggregate.get(key) || { amount: 0n, records: [], party: record.party };
    group.amount += toPaise(record.amount); // signed correction rows net against the original
    group.records.push(record);
    aggregate.set(key, group);
  }
  const evidence = [];
  const represented = new Set();
  for (const candidate of ais[0].records.filter((record) => record.section)) {
    let key = candidate.reference ? `${candidate.section}\0${candidate.reference}` : null;
    if (!key && candidate.party) {
      const matches = [...aggregate].filter(([groupKey, group]) =>
        groupKey.startsWith(`${candidate.section}\0`) && partyKey(group.party) === partyKey(candidate.party));
      if (matches.length === 1) key = matches[0][0];
    }
    const group = key ? aggregate.get(key) : null;
    if (group) represented.add(key);
    const amount = group ? fromPaise(group.amount) : null;
    evidence.push({ section: candidate.section, reference: candidate.reference, party: candidate.party,
      aisCandidateAmount: candidate.amount, form26asAmount: amount,
      comparison: !group ? "missing_26as_group" :
        toPaise(candidate.amount) === group.amount ? "candidate_agrees" : "candidate_differs",
      sourceRefs: references([candidate, ...(group?.records || [])]) });
  }
  for (const [key, group] of aggregate) {
    if (represented.has(key)) continue;
    evidence.push({ section: key.split("\0")[0], reference: key.split("\0")[1], party: group.party,
      aisCandidateAmount: null, form26asAmount: fromPaise(group.amount),
      comparison: "not_read_from_ais", sourceRefs: references(group.records) });
  }
  if (!evidence.length) return insufficient(checkId, "No AIS summary candidates could be linked to Form 26AS.");
  const differing = evidence.filter((item) => item.comparison !== "candidate_agrees").length;
  return result(checkId, "review",
    `${evidence.length - differing} AIS OCR summary candidate(s) agree with Form 26AS; ${differing} need review. This does not establish full AIS transaction coverage.`, evidence);
}

function checkPortalLedger(sources) {
  const checkId = "G01";
  const ledgers = sources.filter((source) => source.role === "supporting_document" &&
    ["gst_cash_ledger", "gst_credit_ledger"].includes(source.documentType));
  if (!ledgers.length || ledgers.some((source) => !usable(source))) return insufficient(checkId,
    "Select complete, in-period GST cash or credit ledger exports.");
  const identities = new Set(ledgers.map((source) => taxpayerKey(source.taxpayerId)).filter(Boolean));
  const years = new Set(ledgers.map((source) => source.financialYear).filter(Boolean));
  if (ledgers.some((source) => !source.taxpayerId || !source.financialYear) || identities.size !== 1 || years.size !== 1) {
    return insufficient(checkId, "GST portal ledgers must identify one taxpayer and one financial year.");
  }
  const evidence = [];
  let checked = 0;
  for (const source of ledgers) {
    const accounts = new Map();
    for (const record of source.records) {
      const key = record.account || "unknown";
      if (!accounts.has(key)) accounts.set(key, []);
      accounts.get(key).push(record);
    }
    for (const [account, rows] of accounts) {
      const openings = rows.filter((row) => row.kind === "opening");
      const closings = rows.filter((row) => row.kind === "closing");
      if (openings.length !== 1 || closings.length !== 1) return insufficient(checkId,
        `GST ledger ${account} is missing a unique opening or closing balance.`);
      let balance = toPaise(openings[0].balance);
      for (const row of rows.filter((item) => item.kind === "transaction")) {
        balance += (row.side === "credit" ? 1n : -1n) * toPaise(row.amount);
        if (balance !== toPaise(row.balance)) evidence.push({ sourceId: source.sourceId, account,
          reference: row.reference, expectedAmount: fromPaise(balance), actualAmount: row.balance,
          differenceAmount: fromPaise(toPaise(row.balance) - balance), sourceRefs: references([row]) });
      }
      if (balance !== toPaise(closings[0].balance)) evidence.push({ sourceId: source.sourceId, account,
        reference: "closing", expectedAmount: fromPaise(balance), actualAmount: closings[0].balance,
        differenceAmount: fromPaise(toPaise(closings[0].balance) - balance), sourceRefs: references(closings) });
      checked += 1;
    }
  }
  return result(checkId, evidence.length ? "difference" : "matched",
    evidence.length ? `${evidence.length} GST portal ledger running balance(s) differ.` :
      `${checked} GST portal ledger account(s) roll forward. This is not a books-versus-portal match.`, evidence);
}

function compareBookCashLedger(sources) {
  const checkId = "G02";
  const books = sources.filter((source) => source.role === "books_ledgers" && usable(source));
  const cash = supportingSources(sources, "gst_cash_ledger");
  if (books.length !== 1 || cash.length !== 1 || !usable(cash[0])) return insufficient(checkId,
    "Select one complete book-ledger export and one GST cash ledger for the same year.");
  if (books[0].financialYear !== cash[0].financialYear || !cash[0].taxpayerId ||
      books[0].taxpayerId && taxpayerKey(books[0].taxpayerId) !== taxpayerKey(cash[0].taxpayerId)) {
    return insufficient(checkId, "Book and GST cash ledgers identify different taxpayers or periods.");
  }
  const evidence = [];
  for (const [account, label] of [["central", "CGST"], ["state", "SGST"]]) {
    const ledger = books[0].records.find((record) =>
      record.accountRole === (label === "CGST" ? "gst_cash_cgst" : "gst_cash_sgst"));
    if (!ledger?.entries?.length) continue;
    const portal = cash[0].records.filter((record) => record.account === account && record.kind === "transaction");
    if (!portal.length) continue;
    const bookDeposits = ledger.entries.filter((entry) => entry.side === "debit")
      .reduce((total, entry) => total + toPaise(entry.amount), 0n);
    const bookUtilization = ledger.entries.filter((entry) => entry.side === "credit")
      .reduce((total, entry) => total + toPaise(entry.amount), 0n);
    const portalDeposits = portal.filter((row) => row.side === "credit")
      .reduce((total, row) => total + toPaise(row.amount), 0n);
    const portalUtilization = portal.filter((row) => row.side === "debit")
      .reduce((total, row) => total + toPaise(row.amount), 0n);
    evidence.push({ taxHead: label, bookDeposits: fromPaise(bookDeposits),
      portalDeposits: fromPaise(portalDeposits), depositDifference: fromPaise(portalDeposits - bookDeposits),
      bookUtilization: fromPaise(bookUtilization), portalUtilization: fromPaise(portalUtilization),
      utilizationDifference: fromPaise(portalUtilization - bookUtilization),
      bookTaxpayerIdentityUnverified: !books[0].taxpayerId,
      sourceRefs: references([...ledger.entries, ...portal]) });
  }
  if (!evidence.length) return insufficient(checkId,
    "No CGST/SGST book cash-ledger movements could be mapped to the portal cash ledger.");
  return result(checkId, "review",
    "Book cash-ledger deposits and utilization are compared by tax head with portal movements; allocate timing and confirm book identity before closing the review.", evidence);
}

function checkStockQuantity(sources) {
  const checkId = "S01";
  const stocks = supportingSources(sources, "stock_product_ledger");
  if (!stocks.length || stocks.some((source) => !usable(source))) return insufficient(checkId,
    "Select a complete product-ledger export.");
  const evidence = [];
  for (const source of stocks) {
    const opening = source.records.find((record) => record.kind === "opening");
    const closing = source.records.find((record) => record.kind === "closing");
    if (!opening || !closing) return insufficient(checkId, "Product-ledger opening or closing is missing.");
    const receipts = source.records.filter((record) => record.kind === "movement")
      .reduce((total, record) => total + toThousandths(record.receiptQuantity), 0n);
    const issues = source.records.filter((record) => record.kind === "movement")
      .reduce((total, record) => total + toThousandths(record.issueQuantity), 0n);
    const receiptTotal = toThousandths(opening.quantity) + receipts;
    const expected = receiptTotal - issues;
    if (receiptTotal !== toThousandths(closing.receiptTotal) ||
        issues !== toThousandths(closing.issueTotal) || expected !== toThousandths(closing.quantity)) {
      evidence.push({ product: opening.product, sourceId: source.sourceId,
        openingQuantity: opening.quantity, receiptQuantity: fromThousandths(receipts),
        issueQuantity: fromThousandths(issues), expectedQuantity: fromThousandths(expected),
        actualQuantity: closing.quantity, sourceRefs: references([opening, closing]) });
    }
  }
  return result(checkId, evidence.length ? "difference" : "matched",
    evidence.length ? `${evidence.length} product quantity roll-forward(s) differ.` :
      `${stocks.length} product quantity roll-forward(s) agree with printed totals.`, evidence);
}

function reviewRefundReference(sources) {
  const checkId = "T09";
  const computations = supportingSources(sources, "tax_computation");
  const ais = sources.filter((source) => source.role === "ais" && source.documentType === "ais");
  if (computations.length !== 1 || ais.length !== 1 || !usable(computations[0]) || hasBlockingSourceIssue(ais[0])) return insufficient(checkId,
    "Select one prior-year computation and one current-year AIS.");
  if (!computations[0].taxpayerId || !ais[0].taxpayerId ||
      taxpayerKey(computations[0].taxpayerId) !== taxpayerKey(ais[0].taxpayerId)) return insufficient(checkId,
    "The computation and AIS identify different taxpayers.");
  const refund = ais[0].records.find((record) => record.category === "REFUND");
  if (!refund) return insufficient(checkId, "AIS refund row could not be read; compare against the original manually.");
  const reference = computations[0].records[0];
  return result(checkId, "review", "Prior-year computation refund and current-year AIS refund need manual allocation and interest review.", [{
    computationAmount: reference.amount, assessmentYear: reference.assessmentYear,
    aisRawRefund: refund.rawText, sourceRefs: references([reference, refund]),
  }]);
}

function reviewTaxCredits(sources) {
  const checkId = "T03";
  const ledgerSources = sources.filter((source) => source.role === "books_ledgers" && usable(source));
  const selectedForms = supportingSources(sources, "form_26as");
  if (ledgerSources.length === 1 && selectedForms.length === 1 && usable(selectedForms[0])) {
    const ledgerSource = ledgerSources[0];
    const form = selectedForms[0];
    if (ledgerSource.financialYear !== form.financialYear || !form.taxpayerId ||
        ledgerSource.taxpayerId && taxpayerKey(ledgerSource.taxpayerId) !== taxpayerKey(form.taxpayerId)) {
      return insufficient(checkId, "The ledger and Form 26AS identify different taxpayers or periods.");
    }
    const evidence = [];
    for (const [type, accountRole] of [["tds", "tds_receivable"],
      ["tcs", "tcs_receivable"]]) {
      const ledger = ledgerSource.records.find((record) => record.accountRole === accountRole);
      if (!ledger?.entries?.length) continue;
      const entries = form.records.filter((record) => record.type === type);
      const formAmount = entries.reduce((total, record) => total + toPaise(record.taxAmount), 0n);
      const bookDebits = ledger.entries.filter((entry) => entry.side === "debit")
        .reduce((total, entry) => total + toPaise(entry.amount), 0n);
      evidence.push({ type, ledger: ledger.ledger,
        form26asTaxCredit: fromPaise(formAmount), bookDebitMovements: fromPaise(bookDebits),
        differenceAmount: fromPaise(formAmount - bookDebits),
        bookOpeningBalance: ledger.openingBalance, bookClosingBalance: ledger.closingBalance,
        bookTaxpayerIdentityUnverified: !ledgerSource.taxpayerId,
        sourceRefs: references([...ledger.entries, ...entries]) });
    }
    if (!evidence.length) return insufficient(checkId,
      "No TDS or TCS receivable ledger movements could be mapped to Form 26AS.");
    return result(checkId, "review",
      "Form 26AS tax credits are compared with dated TDS/TCS ledger debit movements; verify entity identity, timing, and corrections before closing the review.", evidence);
  }
  const books = sources.filter((source) => source.role === "books_vouchers");
  const forms = supportingSources(sources, "form_26as");
  if (books.length !== 1 || !usable(books[0]) || forms.length !== 1 || !usable(forms[0])) {
    return insufficient(checkId, "Select one complete voucher export and one Form 26AS for tax-credit review.");
  }
  if (books[0].taxpayerId && forms[0].taxpayerId &&
      taxpayerKey(books[0].taxpayerId) !== taxpayerKey(forms[0].taxpayerId)) return insufficient(checkId,
    "Books and Form 26AS identify different taxpayers.");
  const evidence = [];
  for (const [type, accountRole] of [["tds", "tds_receivable"], ["tcs", "tcs_receivable"]]) {
    const entries = forms[0].records.filter((record) => record.type === type);
    const postings = books[0].records.filter((record) => record.accountRole === accountRole);
    if (!postings.length) continue;
    const credited = entries.reduce((total, record) => total + toPaise(record.taxAmount), 0n);
    const debits = postings.filter((record) => record.side === "debit")
      .reduce((total, record) => total + toPaise(record.amount), 0n);
    const credits = postings.filter((record) => record.side === "credit")
      .reduce((total, record) => total + toPaise(record.amount), 0n);
    evidence.push({ type, form26asTaxCredit: fromPaise(credited), bookDebitMovements: fromPaise(debits),
      bookCreditMovements: fromPaise(credits),
      bookTaxpayerIdentityUnverified: !books[0].taxpayerId,
      note: "These are different accounting measures; verify book identity and allocate opening balances, timing, and adjustments before concluding a difference.",
      sourceRefs: references([...entries, ...postings]) });
  }
  if (!evidence.length) return insufficient(checkId,
    "No auditor-mapped TDS/TCS receivable book ledgers were found for a safe tie-out.");
  return result(checkId, "review", "Form 26AS tax credits and TDS/TCS book movements require reviewer allocation; no amount-only match is asserted.", evidence);
}

const CHECKS = {
  B01: compareVoucherBalance,
  B02: compareLedgerRollForward,
  B03: compareTrialBalance,
  B04: reviewDormantBalances,
  B05: reviewNegativeCash,
  B06: reviewSuspense,
  B07: reviewPartySign,
  B08: reviewDuplicateVouchers,
  B09: reviewPendingGst,
  B10: reviewInsurancePrepaid,
  B11: reviewPrepaidReversal,
  B20: compareBookExportCoverage,
  P01: comparePriorYear,
  P02: compareYearOnYear,
  AIS01: compareAisIncome,
  AIS02: compareAisTurnover,
  A26: compareAisWith26as,
  G01: checkPortalLedger,
  G02: compareBookCashLedger,
  S01: checkStockQuantity,
  T03: reviewTaxCredits,
  T09: reviewRefundReference,
  X01: reconcileCrossSources,
};

function sourcesForCheck(checkId, sources) {
  const roles = {
    B01: ["books_vouchers"], B02: ["books_ledgers"], B03: ["books_ledgers", "trial_balance"],
    B04: ["books_ledgers"], B05: ["books_ledgers"],
    B06: ["books_ledgers"], B07: ["books_ledgers"], B08: ["books_ledgers", "books_vouchers"],
    B09: ["books_ledgers"], B10: ["books_ledgers"], B11: ["books_ledgers"],
    B20: ["books_vouchers", "books_ledgers"],
    P01: ["trial_balance", "prior_year_trial_balance"], P02: ["trial_balance", "prior_year_trial_balance"],
    AIS01: ["ais", "books_vouchers"], AIS02: ["ais", "books_ledgers", "books_vouchers"],
    A26: ["ais"], G02: ["books_ledgers"], T09: ["ais"],
    T03: ["books_ledgers", "books_vouchers"], X01: ["ais", "books_ledgers", "books_vouchers"],
  }[checkId] || [];
  const supportingTypes = {
    A26: ["form_26as"], G01: ["gst_cash_ledger", "gst_credit_ledger"],
    G02: ["gst_cash_ledger"], S01: ["stock_product_ledger"],
    T03: ["form_26as"], T09: ["tax_computation"],
  }[checkId] || [];
  return sources.filter((source) => roles.includes(source.role) ||
    source.role === "supporting_document" && (checkId === "X01" || supportingTypes.includes(source.documentType)));
}

const CROSS_SOURCE_CHECKS = new Set(["B03", "B20", "P01", "P02", "AIS01", "AIS02", "A26", "G01", "G02", "T03", "T09", "X01"]);

export function runScrutiny({ sources, checkIds = AUDIT_CHECK_IDS, reportTaxpayerId = null, parameters = {} }) {
  if (!Array.isArray(sources) || !Array.isArray(checkIds)) throw new TypeError("sources and checkIds must be arrays.");
  const unknown = checkIds.find((checkId) => !CHECKS[checkId]);
  if (unknown) throw new TypeError(`Unsupported scrutiny check: ${unknown}`);
  const sourceIds = sources.map((source) => source.sourceId);
  if (sourceIds.some((id) => !id) || new Set(sourceIds).size !== sourceIds.length) {
    return { results: checkIds.map((checkId) => insufficient(checkId, "Source IDs are missing or duplicated.")) };
  }
  return { results: [...new Set(checkIds)].map((checkId) => {
    const selected = sourcesForCheck(checkId, sources);
    const identityError = CROSS_SOURCE_CHECKS.has(checkId) ? identityGate(checkId, selected, reportTaxpayerId) : null;
    return provisionalResult(identityError || CHECKS[checkId](sources, parameters), selected);
  }) };
}
