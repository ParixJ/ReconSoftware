const VALID_PERIOD = /^(0[1-9]|1[0-2])\d{4}$/;
const SUMMARY_FIELDS = ["totalChecks", "matched", "mismatched", "exceptions", "highRisk", "totalAbsoluteDifference"];

function normalizeGstin(value) {
  return String(value || "").trim().toUpperCase();
}

function periodsFor(reconciliation) {
  const result = reconciliation?.result || {};
  if (Array.isArray(result.periods) && result.periods.length) return result.periods;
  return result.returnPeriod ? [result] : [];
}

function clientGstinForPeriod(reconciliation, periodResult) {
  const documents = Array.isArray(periodResult.documents) ? periodResult.documents : [];
  const selectedIds = new Set(Array.isArray(reconciliation.documentIds) ? reconciliation.documentIds : []);
  if (selectedIds.size && documents.some((document) => !document.id || !selectedIds.has(document.id))) return null;

  const gstReturns = documents.filter((document) => ["gstr1", "gstr3b"].includes(document.documentType));
  if (gstReturns.length) {
    const distinctGstins = [...new Set(gstReturns.map((document) => normalizeGstin(document.gstin)).filter(Boolean))];
    return distinctGstins.length === 1 ? distinctGstins[0] : null;
  }

  return normalizeGstin(periodResult.clientGstin || reconciliation.result?.clientGstin) || null;
}

export function indexReconciliationHistory(reconciliations) {
  const grouped = new Map();
  const newestFirst = [...(reconciliations || [])].sort((left, right) => (
    Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0)
  ));

  for (const reconciliation of newestFirst) {
    for (const periodResult of periodsFor(reconciliation)) {
      if (!VALID_PERIOD.test(periodResult.returnPeriod || "")) continue;
      const gstin = clientGstinForPeriod(reconciliation, periodResult);
      if (!gstin) continue;
      const year = periodResult.returnPeriod.slice(2);
      if (!grouped.has(gstin)) grouped.set(gstin, new Map());
      const clientYears = grouped.get(gstin);
      if (!clientYears.has(year)) clientYears.set(year, new Map());
      const monthlyResults = clientYears.get(year);
      if (!monthlyResults.has(periodResult.returnPeriod)) {
        monthlyResults.set(periodResult.returnPeriod, {
          ...periodResult,
          clientGstin: gstin,
          status: periodResult.status || reconciliation.status,
          sourceReconciliationId: reconciliation.id,
          reconciledAt: reconciliation.createdAt,
        });
      }
    }
  }

  return Object.fromEntries([...grouped.entries()].map(([gstin, years]) => [
    gstin,
    Object.fromEntries([...years.entries()].map(([year, months]) => [
      year,
      [...months.values()].sort((left, right) => Number(left.returnPeriod.slice(0, 2)) - Number(right.returnPeriod.slice(0, 2))),
    ])),
  ]));
}

function combinedSummary(periods) {
  return periods.reduce((summary, item) => {
    for (const field of SUMMARY_FIELDS) summary[field] += Number(item.summary?.[field] || 0);
    return summary;
  }, Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, 0])));
}

export function buildYearReconciliation(gstin, year, periods) {
  if (!gstin || !year || !periods?.length) return null;
  const documents = [...new Map(periods.flatMap((item) => item.documents || []).map((item) => [item.id, item])).values()];
  const suggestions = [...new Set(periods.flatMap((item) => item.suggestions || []))];
  const sourceIds = [...new Set(periods.map((item) => item.sourceReconciliationId).filter(Boolean))];
  const createdAt = periods.map((item) => item.reconciledAt).filter(Boolean).sort().at(-1) || null;
  const status = periods.some((item) => item.status === "needs_review") ? "needs_review" : "matched";

  return {
    id: `history-${gstin}-${year}-${sourceIds.join("-")}`,
    status,
    documentIds: documents.map((item) => item.id),
    createdAt,
    result: {
      clientGstin: gstin,
      returnPeriod: periods.length === 1 ? periods[0].returnPeriod : null,
      periods,
      documents,
      summary: combinedSummary(periods),
      comparisons: periods.flatMap((item) => item.comparisons || []),
      exceptions: periods.flatMap((item) => item.exceptions || []),
      suggestions,
      methodology: `Latest saved reconciliation for each available monthly return period in ${year}.`,
    },
  };
}
