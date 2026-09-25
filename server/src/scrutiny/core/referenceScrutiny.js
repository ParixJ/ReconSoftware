import { fromPaise, toPaise } from "./money.js";
import { sourceEligibility } from "./sourceEligibility.js";

const ref = (row) => [row?.provenance].filter(Boolean);
const amount = (value) => value === undefined || value === null ? null : toPaise(value);
const money = (value) => fromPaise(value);
const normalizedName = (value) => String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
export const DEFAULT_DUPLICATE_VOUCHER_MIN_AMOUNT = toPaise("15000.00");

function result(checkId, status, summary, evidence = []) {
  return { id: checkId, checkId, status, summary, evidence };
}

function ledgers(sources, checkId) {
  const selected = sources.filter((source) => source.role === "books_ledgers");
  if (!selected.length) return { error: result(checkId, "insufficient_data", "Select a books-ledger source.") };
  const unusable = selected.filter((source) => sourceEligibility(source) === "unusable");
  if (unusable.length) return { error: result(checkId, "insufficient_data",
    "Selected books ledgers have no usable records or conflicting identity/period evidence.",
    unusable.map((source) => ({ sourceId: source.sourceId, issues: source.issues || [] }))) };
  if (checkId !== "B10") {
    const legacy = selected.filter((source) => source.issues?.some((issue) => issue.code === "AUDIT_LEGACY_BALANCE_INFERENCE"));
    if (legacy.length) return { error: result(checkId, "insufficient_data",
      "A legacy ledger source may contain inferred zero balances. Derive a corrected source before balance-based scrutiny.",
      legacy.map((source) => ({ sourceId: source.sourceId, issues: source.issues }))) };
  }
  return { selected };
}

function reviewCandidates(sources, checkId, select, label,
  { needsBalance = false, applies = () => true } = {}) {
  const picked = ledgers(sources, checkId);
  if (picked.error) return picked.error;
  const evidence = [];
  let missing = 0;
  let assessed = 0;
  for (const source of picked.selected) for (const row of source.records) {
    if (!applies(row)) continue;
    if (needsBalance && amount(row.closingBalance) === null) { missing += 1; continue; }
    assessed += 1;
    const candidate = select(row);
    if (candidate) evidence.push({ ...candidate, ledger: row.ledger,
      sourceId: source.sourceId, sourceRefs: ref(row) });
  }
  if (!assessed) return result(checkId, "insufficient_data", missing ?
    `${label}: ${missing} relevant ledger(s) have no explicit closing balance.` :
    `${label}: no ledger could be classified for this name-based check; use explicit account-role mappings or review unclassified ledgers.`,
  [{ kind: "classification_not_established", assessed: 0, missingControls: missing }]);
  return result(checkId, evidence.length || missing ? "review" : "matched",
    `${evidence.length} ${label.toLowerCase()} candidate(s) among ${assessed} assessed ledger(s)` +
      (missing ? `; ${missing} ledger(s) lack explicit closing balances.` : "."), evidence);
}

const suspenseAccount = (row) => /suspense|rounding|misc(?:ellaneous)?\s+(?:adjustment|balance)/i.test(row.ledger);
const partyKind = (row) => {
  const group = `${row.group || ""} ${row.accountRole || ""} ${row.ledger || ""}`;
  const debtor = /sundry\s*debtor|trade\s*receivable|\bdebtors?\b|customer\s*receivable/i.test(group);
  const creditor = /sundry\s*creditor|trade\s*payable|\bcreditors?\b|supplier\s*payable/i.test(group);
  return debtor === creditor ? null : debtor ? "debtor" : "creditor";
};
const gstAccount = (row) => /\b(?:c\s*gst|s\s*gst|i\s*gst|utgst|gst\s*payable|gst\s*input|input\s*tax|output\s*tax|rcm)\b/i.test(row.ledger);

export const reviewSuspense = (sources) => reviewCandidates(sources, "B06", (row) => {
  const closing = amount(row.closingBalance);
  return closing !== 0n ? { closingAmount: money(closing), reason: "Uncleared suspense-type balance" } : null;
}, "Suspense balance", { needsBalance: true, applies: suspenseAccount });

export const reviewPartySign = (sources) => reviewCandidates(sources, "B07", (row) => {
  const kind = partyKind(row);
  const closing = amount(row.closingBalance);
  if (kind === "debtor" && closing < 0n) return { closingAmount: money(closing), reason: "Debtor has a credit balance" };
  if (kind === "creditor" && closing > 0n) return { closingAmount: money(closing), reason: "Creditor has a debit balance" };
  return null;
}, "Debtor/creditor sign", { needsBalance: true, applies: (row) => partyKind(row) !== null });

export const reviewPendingGst = (sources) => reviewCandidates(sources, "B09", (row) => {
  const closing = amount(row.closingBalance);
  return closing !== 0n ? { closingAmount: money(closing), reason: "GST-related closing balance requires portal tie-out" } : null;
}, "Pending GST ledger", { needsBalance: true, applies: gstAccount });

export const reviewInsurancePrepaid = (sources) => {
  const checkId = "B10";
  const picked = ledgers(sources, checkId);
  if (picked.error) return picked.error;
  const evidence = [];
  for (const source of picked.selected) for (const row of source.records) {
    if (!/insurance|ins\.?\s*prem|premium|mediclaim|policy\s*prem/i.test(row.ledger)) continue;
    const prepaid = /prepaid|pre[\s-]?paid|prepayment/i.test(row.ledger);
    evidence.push({ ledger: row.ledger, sourceId: source.sourceId,
      comparison: prepaid ? "prepaid_candidate" : "expense_candidate",
      reason: prepaid ? "Prepaid-style account; confirm amortization" :
        "Insurance expense outside a prepaid-style account; assess unexpired cover",
      debitAmount: row.debits ?? null, creditAmount: row.credits ?? null,
      openingAmount: row.openingBalance ?? null, closingAmount: row.closingBalance ?? null,
      sourceRefs: ref(row) });
  }
  return result(checkId, evidence.length ? "review" : "matched",
    `${evidence.filter((item) => item.comparison === "expense_candidate").length} insurance expense account(s) outside prepaid-style accounts; ` +
      `${evidence.filter((item) => item.comparison === "prepaid_candidate").length} prepaid-style insurance account(s). ` +
      "Account names alone do not establish the coverage period.", evidence);
};

export const reviewPrepaidReversal = (sources) => {
  const checkId = "B11";
  const picked = ledgers(sources, checkId);
  if (picked.error) return picked.error;
  const evidence = [];
  let missing = 0;
  for (const source of picked.selected) for (const row of source.records) {
    if (!/prepaid|pre[\s-]?paid|prepayment/i.test(row.ledger)) continue;
    const opening = amount(row.openingBalance);
    const closing = amount(row.closingBalance);
    if (opening === null || closing === null) { missing += 1; continue; }
    evidence.push({ ledger: row.ledger, sourceId: source.sourceId,
      openingAmount: money(opening), closingAmount: money(closing),
      comparison: opening !== 0n && opening === closing ? "possible_missing_reversal" :
        opening !== 0n && closing === 0n ? "fully_utilized" : "changed",
      sourceRefs: ref(row) });
  }
  if (!evidence.length) return result(checkId, "insufficient_data",
    `No prepaid ledger has both explicit opening and closing controls; ${missing} lack one or both.`);
  const flagged = evidence.filter((item) => item.comparison === "possible_missing_reversal").length;
  return result(checkId, flagged || missing ? "review" : "matched",
    `${flagged} possible missing prepaid reversal(s); ${missing} prepaid ledger(s) lack explicit controls. ` +
      "An unchanged balance is a review candidate, not proof that no expense was recognized.", evidence);
};

function isoDate(value) {
  const text = String(value || "").trim();
  let match = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(text);
  if (match) {
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.toISOString().slice(0, 10) === text ? text : null;
  }
  match = /^(\d{1,2})[-/]([A-Za-z]{3}|\d{1,2})[-/](\d{2}|20\d{2})$/.exec(text);
  if (!match) return null;
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const day = Number(match[1]);
  const month = /^\d+$/.test(match[2]) ? Number(match[2]) : months.indexOf(match[2].toUpperCase()) + 1;
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day ?
    date.toISOString().slice(0, 10) : null;
}

export function reviewDuplicateVouchers(sources, { duplicateVoucherMinAmount = DEFAULT_DUPLICATE_VOUCHER_MIN_AMOUNT } = {}) {
  const checkId = "B08";
  const threshold = typeof duplicateVoucherMinAmount === "bigint" ?
    duplicateVoucherMinAmount : toPaise(duplicateVoucherMinAmount);
  const ledgerSources = sources.filter((source) => source.role === "books_ledgers" && sourceEligibility(source) !== "unusable" &&
    source.records.some((row) => Array.isArray(row.entries) && row.entries.length));
  const voucherSources = sources.filter((source) => source.role === "books_vouchers" && sourceEligibility(source) !== "unusable");
  const chosen = ledgerSources.length ? ledgerSources : voucherSources;
  if (!chosen.length) return result(checkId, "insufficient_data", "Select dated books postings with explicit voucher IDs.");
  const groups = new Map();
  let unassessable = 0;
  for (const source of chosen) for (const ledger of source.records) {
    const entries = source.role === "books_ledgers" ? ledger.entries || [] : [ledger];
    for (const entry of entries) {
      const date = isoDate(entry.date);
      const voucherId = normalizedName(entry.voucherId);
      const value = amount(entry.amount);
      if (!date || !voucherId || !entry.side || value === null || value <= threshold) {
        unassessable += 1; continue;
      }
      const key = [source.sourceId, normalizedName(ledger.ledger), date, entry.side, value].join("\0");
      if (!groups.has(key)) groups.set(key, new Map());
      const identities = groups.get(key);
      if (!identities.has(voucherId)) identities.set(voucherId, []);
      identities.get(voucherId).push({ ledger: ledger.ledger, date, side: entry.side,
        amount: money(value), voucherId: entry.voucherId, sourceRefs: ref(entry) });
    }
  }
  const evidence = [];
  for (const identities of groups.values()) if (identities.size > 1) {
    const representatives = [...identities.values()].map((rows) => rows[0]);
    evidence.push({ ...representatives[0], comparison: "potential_duplicate",
      voucherIds: representatives.map((row) => row.voucherId),
      sourceRefs: representatives.flatMap((row) => row.sourceRefs) });
  }
  return result(checkId, evidence.length || unassessable ? "review" : "matched",
    `${evidence.length} potential duplicate posting group(s) with distinct voucher IDs; ` +
      `${unassessable} posting(s) lack a valid date/ID/amount above ${money(threshold)} for this check.`,
    evidence);
}

export function compareYearOnYear(sources) {
  const checkId = "P02";
  const current = sources.filter((source) => source.role === "trial_balance");
  const prior = sources.filter((source) => source.role === "prior_year_trial_balance");
  if (current.length !== 1 || prior.length !== 1 ||
      sourceEligibility(current[0]) === "unusable" || sourceEligibility(prior[0]) === "unusable") {
    return result(checkId, "insufficient_data", "Select one usable current and one prior-year trial balance.");
  }
  const years = [current[0], prior[0]].map((source) => Number(/^\d{4}/.exec(source.financialYear || "")?.[0]));
  if (years.every(Number.isFinite) && years[0] !== years[1] + 1) return result(checkId,
    "insufficient_data", "The selected trial balances do not cover consecutive financial years.");
  if (current[0].taxpayerId && prior[0].taxpayerId && current[0].taxpayerId !== prior[0].taxpayerId) {
    return result(checkId, "insufficient_data", "The selected trial balances identify different taxpayers.");
  }
  const index = (records) => {
    const map = new Map();
    for (const row of records) {
      const key = normalizedName(row.ledger);
      if (!key || map.has(key)) return null;
      map.set(key, row);
    }
    return map;
  };
  const cy = index(current[0].records), py = index(prior[0].records);
  if (!cy || !py) return result(checkId, "insufficient_data", "Duplicate or missing ledger names prevent year-on-year mapping.");
  const evidence = [];
  for (const key of new Set([...py.keys(), ...cy.keys()])) {
    const before = py.get(key), after = cy.get(key);
    if (!before || !after) {
      evidence.push({ ledger: (before || after).ledger, comparison: before ? "not_in_current_year" : "new_in_current_year",
        priorAmount: before ? money(toPaise(before.closingDebit) - toPaise(before.closingCredit)) : null,
        currentAmount: after ? money(toPaise(after.closingDebit) - toPaise(after.closingCredit)) : null,
        sourceRefs: [...ref(before), ...ref(after)] });
      continue;
    }
    const previous = toPaise(before.closingDebit) - toPaise(before.closingCredit);
    const present = toPaise(after.closingDebit) - toPaise(after.closingCredit);
    const magnitude = (value) => value < 0n ? -value : value;
    const change = magnitude(present) - magnitude(previous);
    const percentBasisPoints = previous === 0n ? null : Number(change * 10000n / magnitude(previous));
    const significant = (change < 0n ? -change : change) >= 10000000n ||
      percentBasisPoints !== null && Math.abs(percentBasisPoints) >= 5000;
    const notable = percentBasisPoints !== null && Math.abs(percentBasisPoints) >= 2000;
    evidence.push({ ledger: after.ledger, comparison: change === 0n ?
      previous !== present ? "matched_sign_convention" : "matched" : significant ?
        "significant_change" : notable ? "notable_change" : "change",
      priorAmount: money(previous), currentAmount: money(present),
      differenceAmount: money(change), percentageChange: percentBasisPoints === null ? null :
        (percentBasisPoints / 100).toFixed(2), sourceRefs: [...ref(before), ...ref(after)] });
  }
  const significant = evidence.filter((row) => row.comparison === "significant_change").length;
  const unmatched = evidence.filter((row) => ["not_in_current_year", "new_in_current_year"].includes(row.comparison)).length;
  return result(checkId, significant ? "difference" : evidence.some((row) =>
    !["matched", "matched_sign_convention"].includes(row.comparison)) ? "review" : "matched",
  `${evidence.length} year-on-year ledger(s) compared; ${significant} significant change(s), ` +
    `${unmatched} account(s) present in only one year. Differences use balance magnitudes to avoid sign-convention inflation.`, evidence);
}
