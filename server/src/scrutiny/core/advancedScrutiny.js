import { fromPaise, toPaise } from "./money.js";
import { compareAmountGroups, comparisonKey, referenceOf } from "./comparisonReport.js";
import { sourceEligibility } from "./sourceEligibility.js";

const ref = (row) => [row?.provenance].filter(Boolean);
const refs = (rows) => rows.flatMap(ref);
const normalized = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const key = (value) => normalized(value).toUpperCase();
const lower = (value) => normalized(value).toLowerCase();
const abs = (value) => value < 0n ? -value : value;
const money = (value) => fromPaise(value);
const amount = (value) => value === undefined || value === null || value === "" ? null : toPaise(value);

function result(checkId, status, summary, evidence = []) {
  return { id: checkId, checkId, status, summary, evidence };
}

function insufficient(checkId, summary, evidence = []) {
  return result(checkId, "insufficient_data", summary, evidence);
}

function support(sources, documentTypes) {
  const wanted = new Set(Array.isArray(documentTypes) ? documentTypes : [documentTypes]);
  return sources.filter((source) => source.role === "supporting_document" &&
    wanted.has(source.documentType) && sourceEligibility(source) !== "unusable");
}

function books(sources, role = "books_ledgers") {
  return sources.filter((source) => source.role === role && sourceEligibility(source) !== "unusable");
}

function parseDate(value) {
  const text = normalized(value);
  if (!text) return null;
  let match = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(text);
  if (match) {
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.toISOString().slice(0, 10) === text ? date : null;
  }
  match = /^(\d{1,2})[-/]([A-Za-z]{3}|\d{1,2})[-/](\d{2}|20\d{2})$/.exec(text);
  if (!match) return null;
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const day = Number(match[1]);
  const month = /^\d+$/.test(match[2]) ? Number(match[2]) : months.indexOf(match[2].toUpperCase()) + 1;
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day ? date : null;
}

const daysBetween = (start, end) => Math.floor((end.getTime() - start.getTime()) / 86_400_000);
const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000);

function bool(value) {
  if (typeof value === "boolean") return value;
  return /^(?:yes|true|y|1|msme|udyam)$/i.test(normalized(value));
}

function ledgerEntries(sources, roles) {
  const wanted = new Set(roles);
  return books(sources, "books_ledgers").flatMap((source) =>
    source.records.flatMap((ledger) => wanted.has(ledger.accountRole) ?
      (ledger.entries || []).map((entry) => ({ ...entry, ledger: ledger.ledger,
        accountRole: ledger.accountRole, sourceId: source.sourceId })) : []));
}

function voucherEntries(sources, roles) {
  const wanted = new Set(roles);
  return books(sources, "books_vouchers").flatMap((source) =>
    source.records.filter((row) => wanted.has(row.accountRole)).map((row) =>
      ({ ...row, sourceId: source.sourceId })));
}

function bookPostings(sources, roles) {
  return [...ledgerEntries(sources, roles), ...voucherEntries(sources, roles)];
}

function sumRows(rows, field = "amount") {
  return rows.reduce((total, row) => total + (amount(row[field]) ?? 0n), 0n);
}

const entryReferenceKey = (row, fallbackParts = []) => {
  const reference = referenceOf(row);
  if (reference) return { value: comparisonKey(reference),
    details: { reference } };
  const date = row.date || row.transactionDate || row.invoiceDate || row.paymentDate || row.dueDate || "";
  const party = row.counterparty || row.party || row.supplier || row.vendor || row.lender || "";
  const amountValue = row.amount || row.depositAmount || row.withdrawalAmount || row.taxAmount || row.closingBalance || "";
  if (!date && !party) return null;
  const parts = [...fallbackParts, date, party, amountValue].map(comparisonKey).filter(Boolean);
  return parts.length ? { value: parts.join("\0"),
    details: { reference: null, date: date || null, counterparty: party || null } } : null;
};

export function reviewPriorYearReport(sources) {
  const checkId = "PY01";
  const reports = support(sources, "prior_year_report");
  const current = books(sources, "trial_balance");
  if (!reports.length) return insufficient(checkId, "Upload a structured prior-year audit report source.");
  const reportRows = reports.flatMap((source) => source.records.map((record) => ({ ...record, sourceId: source.sourceId })));
  const openingRows = current.length === 1 ? new Map(current[0].records.map((row) => [key(row.ledger), row])) : null;
  const evidence = [];
  for (const row of reportRows) {
    const kind = lower(row.kind || row.section || row.category);
    if (/business activity|related party|capital movement|fixed asset|depreciation/.test(kind)) {
      evidence.push({ comparison: "prior_report_disclosure", section: row.section || row.kind || row.category,
        label: row.label || row.ledger || row.party || row.description || null,
        amount: row.amount ?? row.closingBalance ?? null, sourceId: row.sourceId, sourceRefs: ref(row) });
      continue;
    }
    if (!row.ledger || openingRows === null) continue;
    const currentRow = openingRows.get(key(row.ledger));
    if (!currentRow) {
      evidence.push({ comparison: "prior_report_ledger_missing_in_current_opening",
        ledger: row.ledger, priorAmount: row.closingBalance ?? row.amount ?? null,
        sourceRefs: ref(row) });
      continue;
    }
    const prior = amount(row.closingBalance ?? row.amount);
    const opening = amount(currentRow.openingDebit) - amount(currentRow.openingCredit);
    if (prior !== null && prior !== opening) evidence.push({ comparison: "prior_report_opening_difference",
      ledger: row.ledger, priorAmount: money(prior), currentOpeningAmount: money(opening),
      differenceAmount: money(opening - prior), sourceRefs: [...ref(row), ...ref(currentRow)] });
  }
  if (!evidence.length) return result(checkId, "matched",
    `${reportRows.length} prior-year report row(s) loaded; no report disclosures or opening differences were detected.`);
  return result(checkId, evidence.some((row) => row.comparison === "prior_report_opening_difference") ? "difference" : "review",
    `${evidence.length} prior-year report item(s) require carry-forward or disclosure review.`, evidence);
}

export function reviewMsmePayments(sources) {
  const checkId = "M01";
  const registers = support(sources, "msme_register");
  if (!registers.length) return insufficient(checkId, "Upload an MSME register or creditor payment extract.");
  const today = new Date();
  const evidence = [];
  let assessed = 0;
  let missingDates = 0;
  for (const source of registers) for (const row of source.records) {
    if (!(bool(row.isMsme) || row.udyam || row.msmeRegistration || row.msmeNumber)) continue;
    const invoiceDate = parseDate(row.invoiceDate || row.billDate || row.date);
    const dueDate = parseDate(row.dueDate) || (invoiceDate ? addDays(invoiceDate, Number(row.creditDays || 45)) : null);
    const paymentDate = parseDate(row.paymentDate || row.paidDate);
    const outstanding = amount(row.outstandingAmount ?? row.balanceAmount ?? row.unpaidAmount);
    const invoiceAmount = amount(row.amount ?? row.invoiceAmount ?? row.billAmount);
    if (!dueDate || (!paymentDate && outstanding === null)) { missingDates += 1; continue; }
    assessed += 1;
    const delayDays = paymentDate ? daysBetween(dueDate, paymentDate) : daysBetween(dueDate, today);
    if (delayDays > 0 && (outstanding === null || outstanding !== 0n || paymentDate)) {
      evidence.push({ supplier: row.supplier || row.party || row.vendor || null,
        invoiceNumber: row.invoiceNumber || row.billNumber || row.reference || null,
        dueDate: dueDate.toISOString().slice(0, 10), paymentDate: paymentDate?.toISOString().slice(0, 10) || null,
        delayDays, invoiceAmount: invoiceAmount === null ? null : money(invoiceAmount),
        outstandingAmount: outstanding === null ? null : money(outstanding),
        comparison: paymentDate ? "paid_after_msme_due_date" : "outstanding_after_msme_due_date",
        sourceId: source.sourceId, sourceRefs: ref(row) });
    }
  }
  if (!assessed) return insufficient(checkId,
    `No MSME invoice had enough due-date/payment evidence; ${missingDates} MSME row(s) were incomplete.`);
  return result(checkId, evidence.length ? "review" : "matched",
    `${assessed} MSME invoice(s) assessed; ${evidence.length} delayed or overdue item(s).`, evidence);
}

const GST_HEADS = Object.freeze([
  ["gst_cash_igst", "cash", "integrated", "IGST cash"],
  ["gst_cash_cgst", "cash", "central", "CGST cash"],
  ["gst_cash_sgst", "cash", "state", "SGST cash"],
  ["gst_cash_cess", "cash", "cess", "Cess cash"],
  ["gst_credit_igst", "credit", "integrated", "IGST credit"],
  ["gst_credit_cgst", "credit", "central", "CGST credit"],
  ["gst_credit_sgst", "credit", "state", "SGST credit"],
  ["gst_credit_cess", "credit", "cess", "Cess credit"],
]);

export function compareGstBooksToPortal(sources) {
  const checkId = "G03";
  const portals = support(sources, ["gst_cash_ledger", "gst_credit_ledger"]);
  const ledgers = books(sources, "books_ledgers");
  if (!ledgers.length || !portals.length) return insufficient(checkId,
    "Select book ledgers and GST cash/credit portal ledgers for line-level tax-head review.");
  const evidence = [];
  let assessed = 0;
  for (const [role, portalKind, account, label] of GST_HEADS) {
    const bookEntries = ledgerEntries(sources, [role]);
    const portalRows = portals.flatMap((source) => source.documentType === `gst_${portalKind}_ledger` ?
      source.records.filter((row) => row.kind === "transaction" && lower(row.account || row.taxHead).includes(account))
        .map((row) => ({ ...row, sourceId: source.sourceId })) : []);
    if (!bookEntries.length && !portalRows.length) continue;
    assessed += 1;
    for (const [movement, bookSide, portalSide] of [["increase", "debit", "credit"],
      ["utilization", "credit", "debit"]]) {
      const booksForMovement = bookEntries.filter((row) => row.side === bookSide && amount(row.amount) !== null);
      const portalForMovement = portalRows.filter((row) => row.side === portalSide && amount(row.amount) !== null);
      const detailed = compareAmountGroups({
        label: `${label} ${movement}`,
        expectedRows: portalForMovement,
        actualRows: booksForMovement,
        expectedAmountOf: (row) => amount(row.amount),
        actualAmountOf: (row) => amount(row.amount),
        expectedKeyOf: (row) => entryReferenceKey(row, [label, movement]),
        actualKeyOf: (row) => entryReferenceKey(row, [label, movement]),
        expectedSide: "portal",
        actualSide: "books",
        extra: { taxHead: label, movement },
      });
      if (detailed.length) evidence.push(...detailed.map((row) => ({
        ...row, comparison: row.comparison === "difference" ? "gst_transaction_difference" : row.comparison,
      })));
      else {
        const bookAmount = booksForMovement.reduce((total, row) => total + amount(row.amount), 0n);
        const portalAmount = portalForMovement.reduce((total, row) => total + amount(row.amount), 0n);
        const difference = bookAmount - portalAmount;
        if (difference !== 0n || !booksForMovement.length || !portalForMovement.length) {
          evidence.push({ taxHead: label, movement, comparison: "gst_tax_head_aggregate",
            expectedAmount: money(portalAmount), actualAmount: money(bookAmount),
            differenceAmount: money(difference), bookRows: booksForMovement.length,
            portalRows: portalForMovement.length, sourceRefs: refs([...booksForMovement, ...portalForMovement]) });
        }
      }
    }
  }
  if (!assessed) return insufficient(checkId, "No mapped GST book ledgers or portal tax heads were available.");
  return result(checkId, evidence.length ? "difference" : "matched",
    `${assessed} GST cash/credit tax-head bucket(s) assessed; ${evidence.length} bucket(s) differ or are unmapped.`, evidence);
}

export function reviewStockRisk(sources) {
  const checkId = "S02";
  const stocks = support(sources, ["stock_report", "stock_product_ledger"]);
  if (!stocks.length) return insufficient(checkId, "Upload a stock report or product ledger.");
  const evidence = [];
  let assessed = 0;
  for (const source of stocks) for (const row of source.records) {
    const item = row.item || row.product || row.stockItem || row.ledger;
    const closingQuantity = amount(row.closingQuantity ?? row.quantity);
    const closingValue = amount(row.closingValue ?? row.value ?? row.amount);
    const days = Number(row.daysSinceLastMovement ?? row.ageDays ?? row.stockAgeDays);
    if (!item) continue;
    assessed += 1;
    if (closingQuantity !== null && closingQuantity < 0n) evidence.push({ item,
      comparison: "negative_stock_quantity", closingQuantity: row.closingQuantity ?? row.quantity,
      sourceId: source.sourceId, sourceRefs: ref(row) });
    if (Number.isFinite(days) && days >= 180 && (closingQuantity === null || closingQuantity > 0n)) evidence.push({ item,
      comparison: "slow_or_non_moving_stock", daysSinceLastMovement: days,
      closingQuantity: row.closingQuantity ?? row.quantity ?? null, closingValue: closingValue === null ? null : money(closingValue),
      sourceId: source.sourceId, sourceRefs: ref(row) });
    if (closingValue !== null && closingValue < 0n) evidence.push({ item,
      comparison: "negative_stock_value", closingValue: money(closingValue), sourceId: source.sourceId, sourceRefs: ref(row) });
  }
  if (!assessed) return insufficient(checkId, "Stock rows did not contain identifiable item/product names.");
  return result(checkId, evidence.length ? "review" : "matched",
    `${assessed} stock item(s) reviewed; ${evidence.length} negative or slow-moving risk candidate(s).`, evidence);
}

export function reviewBankReconciliation(sources) {
  const checkId = "BK01";
  const statements = support(sources, "bank_statement");
  const postings = bookPostings(sources, ["bank"]);
  if (!statements.length || !postings.length) return insufficient(checkId,
    "Select a bank statement and books postings mapped to the bank account role.");
  const bankRows = statements.flatMap((source) => source.records.map((row) => ({ ...row, sourceId: source.sourceId })));
  const evidence = [];
  for (const [movement, bankField, bookSide] of [["deposit", "depositAmount", "debit"],
    ["withdrawal", "withdrawalAmount", "credit"]]) {
    const supportRows = bankRows.filter((row) => amount(row[bankField] ?? row[movement] ??
      (movement === "deposit" ? row.credit : row.debit)) !== null);
    const bookRows = postings.filter((row) => row.side === bookSide && amount(row.amount) !== null);
    const detailed = compareAmountGroups({
      label: `Bank ${movement}`,
      expectedRows: supportRows,
      actualRows: bookRows,
      expectedAmountOf: (row) => amount(row[bankField] ?? row[movement] ??
        (movement === "deposit" ? row.credit : row.debit)),
      actualAmountOf: (row) => amount(row.amount),
      expectedKeyOf: (row) => entryReferenceKey(row, ["bank", movement]),
      actualKeyOf: (row) => entryReferenceKey(row, ["bank", movement]),
      expectedSide: "bank_statement",
      actualSide: "books",
      extra: { movement },
    });
    if (detailed.length) evidence.push(...detailed.map((row) => ({
      ...row, comparison: row.comparison === "difference" ? "bank_transaction_difference" : row.comparison,
    })));
    else {
      const bankAmount = supportRows.reduce((total, row) => total + amount(row[bankField] ?? row[movement] ??
        (movement === "deposit" ? row.credit : row.debit)), 0n);
      const bookAmount = bookRows.reduce((total, row) => total + amount(row.amount), 0n);
      evidence.push({ comparison: "bank_statement_aggregate", movement,
        expectedAmount: money(bankAmount), actualAmount: money(bookAmount),
        differenceAmount: money(bookAmount - bankAmount),
        bankRows: supportRows.length, bookRows: bookRows.length,
        sourceRefs: refs([...supportRows, ...bookRows]) });
    }
  }
  const differs = evidence.some((row) => row.differenceAmount !== "0.00" ||
    ["unmatched_support", "unmatched_books"].includes(row.comparison));
  return result(checkId, differs ? "review" : "matched",
    "Bank statement lines are matched to mapped bank ledger movements when a reference/date context is available; remaining differences need reviewer allocation.", evidence);
}

export function reviewLoanSchedule(sources) {
  const checkId = "L01";
  const schedules = support(sources, "loan_schedule");
  if (!schedules.length) return insufficient(checkId, "Upload a lender loan schedule.");
  const loanLedgers = books(sources, "books_ledgers").flatMap((source) =>
    source.records.filter((row) => ["loan", "secured_loan", "unsecured_loan"].includes(row.accountRole))
      .map((row) => ({ ...row, sourceId: source.sourceId })));
  const evidence = [];
  let assessed = 0;
  const scheduleRows = schedules.flatMap((source) => source.records.map((row) => ({ ...row, sourceId: source.sourceId })));
  for (const row of scheduleRows) {
    assessed += 1;
    const opening = amount(row.openingBalance);
    const additions = amount(row.additions ?? row.disbursements ?? row.borrowings) ?? 0n;
    const repayments = amount(row.repayments ?? row.principalRepaid) ?? 0n;
    const interest = amount(row.interest ?? row.interestAccrued) ?? 0n;
    const closing = amount(row.closingBalance);
    if (opening !== null && closing !== null) {
      const expected = opening + additions + interest - repayments;
      if (expected !== closing) evidence.push({ lender: row.lender || row.party || row.ledger || null,
        comparison: "loan_schedule_roll_forward_difference", expectedAmount: money(expected),
        actualAmount: money(closing), differenceAmount: money(closing - expected), sourceRefs: ref(row) });
    }
    const match = loanLedgers.find((ledger) => key(ledger.ledger) === key(row.ledger || row.lender || row.party));
    if (match && closing !== null && amount(match.closingBalance) !== null && amount(match.closingBalance) !== closing) {
      evidence.push({ lender: row.lender || row.party || row.ledger || match.ledger,
        comparison: "loan_books_schedule_closing_difference",
        expectedAmount: money(closing), actualAmount: match.closingBalance,
        differenceAmount: money(amount(match.closingBalance) - closing),
        sourceRefs: [...ref(row), ...ref(match)] });
    }
  }
  const detailed = compareAmountGroups({
    label: "Loan schedule closing",
    expectedRows: scheduleRows.filter((row) => amount(row.closingBalance) !== null),
    actualRows: loanLedgers.filter((row) => amount(row.closingBalance) !== null),
    expectedAmountOf: (row) => amount(row.closingBalance),
    actualAmountOf: (row) => amount(row.closingBalance),
    expectedKeyOf: (row) => ({ value: comparisonKey(row.ledger || row.lender || row.party),
      details: { lender: row.lender || row.party || row.ledger || null } }),
    actualKeyOf: (row) => ({ value: comparisonKey(row.ledger),
      details: { lender: row.ledger || null } }),
    expectedSide: "loan_schedule",
    actualSide: "books",
    extra: { comparisonBasis: "closing_balance" },
  });
  evidence.push(...detailed.filter((row) => row.comparison !== "matched")
    .map((row) => ({ ...row, comparison: row.comparison === "difference" ?
      "loan_books_schedule_closing_difference" : row.comparison })));
  return result(checkId, evidence.length ? "difference" : loanLedgers.length ? "matched" : "review",
    `${assessed} loan schedule row(s) assessed; ${evidence.length} roll-forward or book tie-out difference(s).`, evidence);
}

export function reviewAdvanceTaxChallans(sources) {
  const checkId = "AT01";
  const challans = support(sources, "tax_challan");
  if (!challans.length) return insufficient(checkId, "Upload advance-tax/GST-TDS challan evidence.");
  const rows = challans.flatMap((source) => source.records.map((row) => ({ ...row, sourceId: source.sourceId })));
  const roleFor = (type) => /gst\s*tds|gstds/i.test(type) ? "gst_tds_payable" : "advance_tax";
  const evidence = [];
  for (const [type, role] of [["advance_tax", "advance_tax"], ["gst_tds", "gst_tds_payable"]]) {
    const taxRows = rows.filter((row) => roleFor(row.type || row.taxType || row.challanType) === role);
    const bookRows = bookPostings(sources, [role]);
    if (!taxRows.length && !bookRows.length) continue;
    const detailed = compareAmountGroups({
      label: `${type} challan`,
      expectedRows: taxRows,
      actualRows: bookRows,
      expectedAmountOf: (row) => amount(row.amount),
      actualAmountOf: (row) => amount(row.amount),
      expectedKeyOf: (row) => entryReferenceKey(row, [type]),
      actualKeyOf: (row) => entryReferenceKey(row, [type]),
      expectedSide: "challan",
      actualSide: "books",
      extra: { type },
    });
    if (detailed.length) evidence.push(...detailed.map((row) => ({
      ...row, comparison: row.comparison === "difference" ? "tax_challan_entry_difference" : row.comparison,
    })));
    else {
      const externalAmount = sumRows(taxRows, "amount");
      const bookAmount = sumRows(bookRows, "amount");
      if (externalAmount !== bookAmount || !taxRows.length || !bookRows.length) evidence.push({ type,
        comparison: "tax_challan_books_total", expectedAmount: money(externalAmount),
        actualAmount: money(bookAmount), differenceAmount: money(bookAmount - externalAmount),
        challanRows: taxRows.length, bookRows: bookRows.length,
        sourceRefs: refs([...taxRows, ...bookRows]) });
    }
  }
  if (!evidence.length) return result(checkId, "matched", "Advance-tax/GST-TDS challan totals agree with mapped book postings.");
  return result(checkId, "review", `${evidence.length} tax challan bucket(s) require book tie-out review.`, evidence);
}

const TDS_RULES = Object.freeze([
  { section: "194J", role: "professional_fees", label: "Professional fees", rateBps: 1000, threshold: "30000.00", pattern: /professional|consultancy|technical/i },
  { section: "194C", role: "contractor", label: "Contractor payments", rateBps: 200, threshold: "100000.00", pattern: /contract|labour|job\s*work/i },
  { section: "194I", role: "rent", label: "Rent", rateBps: 1000, threshold: "240000.00", pattern: /\brent\b|lease/i },
  { section: "194A", role: "interest_expense", label: "Interest expense", rateBps: 1000, threshold: "40000.00", pattern: /interest/i },
  { section: "194H", role: "commission", label: "Commission or brokerage", rateBps: 500, threshold: "15000.00", pattern: /commission|brokerage/i },
]);

export function reviewTdsAuditor(sources) {
  const checkId = "TDS01";
  const expenseRows = [];
  for (const source of [...books(sources, "books_vouchers"), ...books(sources, "books_ledgers")]) {
    for (const row of source.records) {
      const entries = source.role === "books_ledgers" ? row.entries || [] : [row];
      for (const entry of entries) {
        const ledgerName = row.ledger || entry.ledger;
        const rule = TDS_RULES.find((item) => row.accountRole === item.role || entry.accountRole === item.role ||
          item.pattern.test(ledgerName || ""));
        if (rule && (entry.side || row.side) === "debit") expenseRows.push({ ...entry, ledger: ledgerName,
          counterparty: entry.counterparty || row.counterparty || row.party, rule, sourceId: source.sourceId });
      }
    }
  }
  if (!expenseRows.length) return insufficient(checkId,
    "No expense postings could be classified against the built-in TDS auditor rules.");
  const tdsCredits = bookPostings(sources, ["tds_payable", "tds_receivable"])
    .filter((row) => row.side === "credit" || row.accountRole === "tds_payable");
  const evidence = [];
  for (const rule of TDS_RULES) {
    const rows = expenseRows.filter((row) => row.rule.section === rule.section);
    if (!rows.length) continue;
    const gross = sumRows(rows);
    const threshold = toPaise(rule.threshold);
    const expected = gross > threshold ? gross * BigInt(rule.rateBps) / 10000n : 0n;
    const booked = tdsCredits.filter((row) => !row.section || row.section === rule.section ||
      lower(row.narration || row.ledger).includes(lower(rule.section))).reduce((total, row) => total + amount(row.amount), 0n);
    if (expected > 0n || booked > 0n) evidence.push({ section: rule.section, label: rule.label,
      comparison: expected === booked ? "tds_expected_matches_booked" : "tds_expected_differs_from_booked",
      grossAmount: money(gross), thresholdAmount: rule.threshold, expectedTdsAmount: money(expected),
      bookedTdsAmount: money(booked), differenceAmount: money(booked - expected),
      ratePercent: (rule.rateBps / 100).toFixed(2), expenseRows: rows.length,
      note: "This is an applicability screen from mapped/head-classified books; vendor status, lower deduction certificates, and legal exceptions remain reviewer inputs.",
      sourceRefs: refs([...rows, ...tdsCredits]) });
  }
  if (!evidence.length) return result(checkId, "matched",
    `${expenseRows.length} TDS-classified expense posting(s) are below configured thresholds.`);
  return result(checkId, evidence.some((row) => row.comparison === "tds_expected_differs_from_booked") ? "review" : "matched",
    `${evidence.length} TDS rule bucket(s) assessed from classified expense postings.`, evidence);
}
