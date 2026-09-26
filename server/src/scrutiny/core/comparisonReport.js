import { fromPaise, toPaise } from "./money.js";

const normalize = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
export const comparisonKey = (value) => normalize(value).toUpperCase();

export function referenceOf(row) {
  return normalize(row.reference || row.invoiceNumber || row.billNumber || row.voucherId ||
    row.challanSerial || row.tan || row.utr || row.transactionId);
}

export function periodOf(row) {
  return normalize(row.taxPeriod || row.period || row.month || row.date || row.transactionDate);
}

export function sourceRef(row) {
  return row?.provenance || null;
}

export function comparisonEntry(row, amountValue, sideLabel) {
  return {
    side: sideLabel,
    amount: fromPaise(amountValue),
    sourceId: row.sourceId || row.provenance?.sourceId || null,
    sourceRef: sourceRef(row),
    ledger: row.ledger || row.account || null,
    reference: referenceOf(row) || null,
    period: periodOf(row) || null,
    date: row.date || row.transactionDate || row.invoiceDate || row.paymentDate || null,
    counterparty: row.counterparty || row.party || row.supplier || row.vendor || row.lender || null,
    narration: row.narration || row.description || row.particulars || null,
  };
}

function groupRows(rows, amountOf, keyOf, sideLabel) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key || !key.value) continue;
    const amount = amountOf(row);
    const group = groups.get(key.value) || { key: key.value, details: key.details || {},
      amount: 0n, rows: [], entries: [] };
    group.amount += amount;
    group.rows.push(row);
    group.entries.push(comparisonEntry(row, amount, sideLabel));
    groups.set(key.value, group);
  }
  return groups;
}

export function compareAmountGroups({
  label,
  expectedRows,
  actualRows,
  expectedAmountOf,
  actualAmountOf,
  expectedKeyOf,
  actualKeyOf,
  expectedSide = "supporting",
  actualSide = "books",
  matchedComparison = "matched",
  differenceComparison = "difference",
  unmatchedExpectedComparison = "unmatched_support",
  unmatchedActualComparison = "unmatched_books",
  quality = "verified",
  maxEntries = 25,
  extra = {},
}) {
  const expected = groupRows(expectedRows, expectedAmountOf, expectedKeyOf, expectedSide);
  const actual = groupRows(actualRows, actualAmountOf, actualKeyOf, actualSide);
  const rows = [];
  for (const key of new Set([...expected.keys(), ...actual.keys()])) {
    const expectedGroup = expected.get(key);
    const actualGroup = actual.get(key);
    const expectedAmount = expectedGroup?.amount ?? 0n;
    const actualAmount = actualGroup?.amount ?? 0n;
    const difference = actualAmount - expectedAmount;
    const baseComparison = !expectedGroup ? unmatchedActualComparison :
      !actualGroup ? unmatchedExpectedComparison :
        difference === 0n ? matchedComparison : differenceComparison;
    const comparison = quality !== "verified" && baseComparison === matchedComparison ? "review" : baseComparison;
    const sourceRefs = [...(expectedGroup?.rows || []), ...(actualGroup?.rows || [])]
      .map(sourceRef).filter(Boolean).slice(0, 100);
    rows.push({
      label,
      comparison,
      comparisonKey: key,
      ...(expectedGroup?.details || actualGroup?.details || {}),
      expectedAmount: fromPaise(expectedAmount),
      actualAmount: fromPaise(actualAmount),
      differenceAmount: fromPaise(difference),
      expectedRecordCount: expectedGroup?.rows.length || 0,
      actualRecordCount: actualGroup?.rows.length || 0,
      expectedEntries: (expectedGroup?.entries || []).slice(0, maxEntries),
      actualEntries: (actualGroup?.entries || []).slice(0, maxEntries),
      sourceRefs,
      ...extra,
    });
  }
  return rows;
}

export function amountFrom(field, sign = 1n) {
  return (row) => sign * toPaise(row[field]);
}
