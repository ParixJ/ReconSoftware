import { fromPaise, toPaise } from "./money.js";
import { comparisonEntry } from "./comparisonReport.js";
import { hasConflictingSourceIssue, provisionalResult, sourceEligibility } from "./sourceEligibility.js";

const ROLE_DIRECTION = new Map([
  ["sales", "credit"], ["business_receipts", "credit"], ["interest_income", "credit"],
  ["purchases", "debit"], ["tds_receivable", "debit"], ["tcs_receivable", "debit"],
  ["gst_cash_igst", "debit"], ["gst_cash_cgst", "debit"],
  ["gst_cash_sgst", "debit"], ["gst_cash_cess", "debit"],
  ["gst_credit_igst", "debit"], ["gst_credit_cgst", "debit"],
  ["gst_credit_sgst", "debit"], ["gst_credit_cess", "debit"],
]);
const TIS_ROLE = new Map([
  ["gst_turnover", "sales"], ["gst_purchases", "purchases"],
  ["business_receipts", "business_receipts"], ["interest_deposit", "interest_income"],
]);
const COMPARABLE_SUPPORT_TYPES = new Set([
  "tis", "form_26as", "gst_cash_ledger", "gst_credit_ledger", "tax_computation", "audit_queries",
]);

function fyOf(value) {
  if (!value) return null;
  const text = String(value);
  let year;
  let month;
  const iso = /^(20\d{2})(\d{2})(\d{2})$/.exec(text) || /^(20\d{2})-(\d{2})-(\d{2})$/.exec(text);
  const dmy = /^(\d{1,2})[-\/]([A-Za-z]{3}|\d{1,2})[-\/](\d{2,4})$/.exec(text);
  if (iso) { year = Number(iso[1]); month = Number(iso[2]); }
  else if (dmy) {
    year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    month = Number(dmy[2]);
    if (!month) month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
      .indexOf(dmy[2].toUpperCase()) + 1;
  }
  if (!year || !month || month < 1 || month > 12) return null;
  const start = month >= 4 ? year : year - 1;
  return `${start}-${start + 1}`;
}

function identity(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized.length === 15 ? normalized.slice(2, 12) : normalized;
}

function bookAccountRows(sources) {
  const statementSources = sources.filter((source) => source.role === "books_ledgers" && sourceEligibility(source) !== "unusable");
  const voucherSources = sources.filter((source) => source.role === "books_vouchers" && sourceEligibility(source) !== "unusable");
  const statements = statementSources.flatMap((source) => source.records.flatMap((record) => {
    if (!ROLE_DIRECTION.has(record.accountRole)) return [];
    const entries = Array.isArray(record.entries) && record.entries.length ? record.entries : [
      ...(record.debits !== undefined ? [{ side: "debit", amount: record.debits, provenance: record.provenance }] : []),
      ...(record.credits !== undefined ? [{ side: "credit", amount: record.credits, provenance: record.provenance }] : []),
    ];
    return entries.map((entry) => ({ ...entry, accountRole: record.accountRole,
      ledger: record.ledger, financialYear: fyOf(entry.date) || source.financialYear,
      sourceId: source.sourceId, taxpayerId: source.taxpayerId }));
  }));
  if (statements.length) return statements;
  return voucherSources.flatMap((source) => source.records.filter((record) => ROLE_DIRECTION.has(record.accountRole))
    .map((record) => ({ ...record, financialYear: fyOf(record.date) || source.financialYear,
      sourceId: source.sourceId, taxpayerId: source.taxpayerId })));
}

function totalFor(rows, role, year, side = null) {
  let total = 0n;
  const evidence = [];
  for (const row of rows) {
    if (row.accountRole !== role || row.financialYear !== year) continue;
    if (side && row.side !== side) continue;
    total += (side || row.side === ROLE_DIRECTION.get(role) ? 1n : -1n) * toPaise(row.amount);
    if (row.provenance && evidence.length < 100) evidence.push(row.provenance);
  }
  return { amount: total, sourceRefs: evidence };
}

function normalizedRef(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function monthPeriod(value) {
  const text = String(value || "").trim().toUpperCase();
  let match = /^(20\d{2})-?(0[1-9]|1[0-2])(?:-?\d{2})?$/.exec(text);
  if (match) return `${match[1]}-${match[2]}`;
  match = /^\d{1,2}[-/](0?[1-9]|1[0-2])[-/](20\d{2})$/.exec(text);
  if (match) return `${match[2]}-${match[1].padStart(2, "0")}`;
  match = /^(?:\d{1,2}[-/])?([A-Z]{3})[-/](20\d{2}|\d{2})$/.exec(text);
  if (match) {
    const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
      .indexOf(match[1]) + 1;
    if (month) return `${match[2].length === 2 ? `20${match[2]}` : match[2]}-${String(month).padStart(2, "0")}`;
  }
  return null;
}

export function matchReferencedTransactions(bookRows, supportRows, { role, year, quality = "verified" }) {
  const groups = new Map();
  const add = (side, row) => {
    const reference = normalizedRef(row.reference || row.voucherId);
    const taxPeriod = monthPeriod(row.taxPeriod || row.period || row.date);
    const key = `${reference || `${side}:UNREFERENCED`}\0${taxPeriod || "UNKNOWN"}`;
    if (!groups.has(key)) groups.set(key, { reference: reference || null, taxPeriod, books: [], support: [] });
    groups.get(key)[side].push(row);
  };
  for (const row of bookRows.filter((item) => item.accountRole === role && item.financialYear === year)) add("books", row);
  for (const row of supportRows) add("support", row);
  return [...groups.values()].map((group) => {
    const bookAmount = group.books.reduce((sum, row) => sum +
      (row.side === ROLE_DIRECTION.get(role) ? 1n : -1n) * toPaise(row.amount), 0n);
    const supportAmount = group.support.reduce((sum, row) => sum + toPaise(row.amount), 0n);
    const counterparties = (rows) => new Set(rows.map((row) => normalizedRef(row.counterparty || row.party)).filter(Boolean));
    const bookParties = counterparties(group.books);
    const supportParties = counterparties(group.support);
    const ambiguous = bookParties.size > 1 || supportParties.size > 1 ||
      bookParties.size && supportParties.size && [...bookParties][0] !== [...supportParties][0];
    const baseComparison = !group.books.length ? "unmatched_support" : !group.support.length ? "unmatched_books" :
      ambiguous ? "ambiguous" : quality !== "verified" || !group.taxPeriod ? "review" :
        bookAmount === supportAmount ? "matched" : "difference";
    const comparison = quality !== "verified" && ["unmatched_support", "unmatched_books"].includes(baseComparison) ?
      "review" : baseComparison;
    return { label: `${role} reference ${group.reference || "missing"}`, financialYear: year,
      accountRole: role, reference: group.reference, taxPeriod: group.taxPeriod,
      comparisonKey: `${group.reference || "missing"}:${group.taxPeriod || "UNKNOWN"}`, comparison,
      ...(comparison !== baseComparison ? { reviewReason: baseComparison } : {}),
      bookRecordCount: group.books.length, supportRecordCount: group.support.length,
      expectedAmount: fromPaise(supportAmount), actualAmount: fromPaise(bookAmount),
      differenceAmount: fromPaise(bookAmount - supportAmount),
      expectedEntries: group.support.map((row) => comparisonEntry(row, toPaise(row.amount), "supporting")).slice(0, 25),
      actualEntries: group.books.map((row) => comparisonEntry(row,
        (row.side === ROLE_DIRECTION.get(role) ? 1n : -1n) * toPaise(row.amount), "books")).slice(0, 25),
      sourceRefs: [...group.books, ...group.support].map((row) => row.provenance).filter(Boolean).slice(0, 100) };
  });
}

function addComparison(evidence, bookRows, { role, year, expected, supportingRefs, label,
  quality = "verified", side = null, entityUnverified = false }) {
  const book = totalFor(bookRows, role, year, side);
  if (!book.sourceRefs.length) {
    evidence.push({ label, financialYear: year, accountRole: role, comparison: "mapping_required",
      expectedAmount: fromPaise(expected), actualAmount: null, differenceAmount: null,
      sourceRefs: supportingRefs });
    return;
  }
  const difference = book.amount - expected;
  evidence.push({ label, financialYear: year, accountRole: role,
    comparison: quality !== "verified" || entityUnverified ? "review" : difference ? "difference" : "matched",
    expectedAmount: fromPaise(expected), actualAmount: fromPaise(book.amount),
    differenceAmount: fromPaise(difference), basis: side ? `${side}_movement` : "net_movement",
    sourceRefs: [...supportingRefs, ...book.sourceRefs] });
}

function addAuditQueryEvidence(evidence, source, year) {
  for (const row of source.records || []) {
    if (row.queryType === "manual_amount_difference") {
      const difference = row.differenceAmount || null;
      evidence.push({ label: `Manual query ${row.ledger}`, financialYear: year,
        comparison: difference && difference !== "0.00" ? "difference" : "matched",
        queryType: row.queryType, query: row.query || null, expectedAmount: row.supportAmount,
        actualAmount: row.bookAmount, differenceAmount: difference,
        sourceRefs: [row.provenance].filter(Boolean) });
    } else if (row.queryType === "opening_balance_difference") {
      evidence.push({ label: `Opening balance ${row.ledger}`, financialYear: year,
        comparison: row.differenceAmount && row.differenceAmount !== "0.00" ? "difference" : "matched",
        queryType: row.queryType, balanceSide: row.balanceSide, ledger: row.ledger,
        expectedAmount: row.reportAmount, actualAmount: row.bookAmount,
        differenceAmount: row.differenceAmount,
        sourceRefs: [row.provenance].filter(Boolean) });
    } else if (row.queryType === "depreciation_schedule") {
      evidence.push({ label: `Depreciation schedule ${row.asset}`, financialYear: year,
        comparison: "review", queryType: row.queryType, asset: row.asset,
        expectedAmount: row.closingWdv, actualAmount: null, differenceAmount: null,
        depreciationAmount: row.depreciation, sourceRefs: [row.provenance].filter(Boolean) });
    } else {
      evidence.push({ label: `Manual query ${row.ledger || row.asset || "review"}`, financialYear: year,
        comparison: "review", queryType: row.queryType || row.kind, ledger: row.ledger || null,
        query: row.query || null, expectedAmount: row.amount || null,
        actualAmount: null, differenceAmount: null,
        sourceRefs: [row.provenance].filter(Boolean) });
    }
  }
}

export function reconcileCrossSources(sources) {
  const books = sources.filter((source) => ["books_ledgers", "books_vouchers"].includes(source.role));
  const evidenceSources = sources.filter((source) => source.role === "ais" ||
    source.role === "supporting_document" && COMPARABLE_SUPPORT_TYPES.has(source.documentType));
  if (!books.length || !evidenceSources.length) return { id: "X01", checkId: "X01", status: "insufficient_data",
    summary: "Select books and at least one supporting source.", evidence: [] };
  if (books.some((source) => sourceEligibility(source) === "unusable") ||
      evidenceSources.some((source) => hasConflictingSourceIssue(source))) return {
    id: "X01", checkId: "X01", status: "insufficient_data",
    summary: "A selected source has no usable records or has conflicting identity/period evidence.",
    evidence: [...books, ...evidenceSources].filter((source) => sourceEligibility(source) === "unusable" ||
      hasConflictingSourceIssue(source))
      .map((source) => ({ sourceId: source.sourceId, issues: source.issues || [] })) };
  const usableEvidenceSources = evidenceSources.filter((source) => sourceEligibility(source) !== "unusable");
  if (!usableEvidenceSources.length) return { id: "X01", checkId: "X01", status: "insufficient_data",
    summary: "No supporting source has normalized records for this comparison.",
    evidence: evidenceSources.map((source) => ({ sourceId: source.sourceId, issues: source.issues || [] })) };
  const unavailableSources = evidenceSources.filter((source) => sourceEligibility(source) === "unusable");
  const known = new Set([...books, ...evidenceSources].map((source) => identity(source.taxpayerId)).filter(Boolean));
  if (known.size > 1) return { id: "X01", checkId: "X01", status: "insufficient_data",
    summary: "Selected sources identify different taxpayers; no cross-source match was asserted.", evidence: [] };
  const seenLedgers = new Set();
  for (const source of books.filter((item) => item.role === "books_ledgers")) {
    for (const record of source.records || []) {
      if (!record.accountRole) continue;
      const key = `${source.financialYear}\0${record.ledger?.trim().toUpperCase()}`;
      if (seenLedgers.has(key)) return { id: "X01", checkId: "X01", status: "insufficient_data",
        summary: "Mapped ledger accounts overlap across selected exports; remove duplicate coverage or revise the selection.",
        evidence: [{ ledger: record.ledger, sourceRefs: [record.provenance].filter(Boolean) }] };
      seenLedgers.add(key);
    }
  }
  const bookRows = bookAccountRows(sources);
  if (!bookRows.length) return { id: "X01", checkId: "X01", status: "insufficient_data",
    summary: "Approve account-role mappings for the selected book ledgers before cross-source comparison.", evidence: [] };
  const entityUnverified = books.every((source) => !source.taxpayerId);
  const evidence = [];
  for (const source of usableEvidenceSources) {
    if (!source.financialYear || !source.records?.length) continue;
    const year = source.financialYear;
    const quality = source.ocrUsed || source.status !== "ready" ? "review" : "verified";
    if (source.documentType === "tis") {
      for (const row of source.records.filter((record) => record.kind === "category_total")) {
        const role = TIS_ROLE.get(row.category);
        if (!role) continue;
        addComparison(evidence, bookRows, { role, year, expected: toPaise(row.acceptedAmount || row.amount),
          supportingRefs: [row.provenance], label: `TIS ${row.category}`, quality, entityUnverified });
      }
      for (const [category, role] of TIS_ROLE) {
        const detail = source.records.filter((row) => row.kind === "detail" && row.category === category)
          .map((row) => ({ ...row, amount: row.amount, reference: row.reference }));
        if (detail.some((row) => row.reference)) evidence.push(...matchReferencedTransactions(bookRows, detail,
          { role, year, quality: "review" }));
      }
    } else if (source.documentType === "form_26as") {
      for (const [type, role] of [["tds", "tds_receivable"], ["tcs", "tcs_receivable"]]) {
        const rows = source.records.filter((row) => row.type === type);
        if (!rows.length) continue;
        addComparison(evidence, bookRows, { role, year,
          expected: rows.reduce((sum, row) => sum + toPaise(row.taxAmount), 0n),
          supportingRefs: rows.map((row) => row.provenance), label: `Form 26AS ${type.toUpperCase()} credit`,
          quality: "review", entityUnverified });
        if (rows.some((row) => row.tan)) evidence.push(...matchReferencedTransactions(bookRows,
          rows.map((row) => ({ ...row, reference: row.tan, amount: row.taxAmount })),
          { role, year, quality: "review" }));
      }
    } else if (source.documentType === "gst_cash_ledger") {
      for (const [head, role] of [["integrated", "gst_cash_igst"], ["central", "gst_cash_cgst"],
        ["state", "gst_cash_sgst"], ["cess", "gst_cash_cess"]]) {
        const rows = source.records.filter((row) => row.kind === "transaction" && row.account === head);
        for (const [portalSide, bookSide, label] of [["credit", "debit", "deposit"],
          ["debit", "credit", "utilization"]]) {
          const selected = rows.filter((row) => row.side === portalSide);
          if (!selected.length) continue;
          addComparison(evidence, bookRows, { role, year, side: bookSide,
            expected: selected.reduce((sum, row) => sum + toPaise(row.amount), 0n),
            supportingRefs: selected.map((row) => row.provenance),
            label: `GST cash ${head} ${label}`, quality: "review", entityUnverified });
        }
      }
    } else if (source.documentType === "gst_credit_ledger") {
      for (const [head, role] of [["integrated", "gst_credit_igst"], ["central", "gst_credit_cgst"],
        ["state", "gst_credit_sgst"], ["cess", "gst_credit_cess"]]) {
        const rows = source.records.filter((row) => row.kind === "transaction" && row.taxHeads?.[head] !== undefined);
        for (const [portalSide, bookSide, label] of [["credit", "debit", "accrual"],
          ["debit", "credit", "utilization"]]) {
          const selected = rows.filter((row) => row.side === portalSide);
          if (!selected.length) continue;
          addComparison(evidence, bookRows, { role, year, side: bookSide,
            expected: selected.reduce((sum, row) => sum + toPaise(row.taxHeads[head]), 0n),
            supportingRefs: selected.map((row) => row.provenance),
            label: `GST credit ${head} ${label}`, quality: "review", entityUnverified });
        }
      }
    } else if (source.documentType === "tax_computation") {
      for (const [kind, role] of [["gst_turnover", "sales"], ["interest_deposit", "interest_income"]]) {
        const row = source.records.find((item) => item.kind === kind);
        if (!row) continue;
        addComparison(evidence, bookRows, { role, year, expected: toPaise(row.amount),
          supportingRefs: [row.provenance], label: `Computation ${kind}`, quality: "review", entityUnverified });
      }
    } else if (source.documentType === "audit_queries") {
      addAuditQueryEvidence(evidence, source, year);
    } else if (source.role === "ais") {
      for (const row of source.records.filter((item) => item.category === "GST_TURNOVER" && item.amount)) {
        addComparison(evidence, bookRows, { role: "sales", year, expected: toPaise(row.amount),
          supportingRefs: [row.provenance], label: "AIS GST turnover", quality: "review", entityUnverified });
      }
      for (const [category, role] of [["INTEREST", "interest_income"],
        ["SAVINGS_INTEREST", "interest_income"], ["TERM_DEPOSIT_INTEREST", "interest_income"],
        ["RECURRING_DEPOSIT_INTEREST", "interest_income"],
        ["BUSINESS_RECEIPTS", "business_receipts"]]) {
        const detail = source.records.filter((row) => row.category === category && row.amount);
        if (detail.some((row) => row.reference)) evidence.push(...matchReferencedTransactions(bookRows,
          detail, { role, year, quality: entityUnverified ? "review" : quality }));
      }
    }
  }
  if (!evidence.length) return { id: "X01", checkId: "X01", status: "insufficient_data",
    summary: "No like-for-like supporting measures were available for mapped book accounts.", evidence };
  for (const source of unavailableSources) evidence.push({ kind: "source_unavailable",
    sourceId: source.sourceId, issues: source.issues || [] });
  const counts = evidence.reduce((map, row) => map.set(row.comparison, (map.get(row.comparison) || 0) + 1), new Map());
  const status = counts.get("mapping_required") === evidence.length - unavailableSources.length ? "insufficient_data" :
    counts.has("mapping_required") || unavailableSources.length ? "review" :
    ["difference", "unmatched_books", "unmatched_support"].some((key) => counts.has(key)) ? "difference" :
    ["review", "ambiguous"].some((key) => counts.has(key)) ? "review" : "matched";
  return provisionalResult({ id: "X01", checkId: "X01", status,
    summary: `${evidence.length} cross-source measure(s): ${counts.get("matched") || 0} matched, ` +
      `${counts.get("difference") || 0} different, ${counts.get("review") || 0} review, ` +
      `${counts.get("mapping_required") || 0} require mapping; ` +
      `${(counts.get("unmatched_books") || 0) + (counts.get("unmatched_support") || 0)} unmatched; ` +
      `${unavailableSources.length} selected supporting source(s) unavailable.`, evidence },
    [...books, ...evidenceSources]);
}
