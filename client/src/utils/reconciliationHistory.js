const VALID_PERIOD = /^(0[1-9]|1[0-2])\d{4}$/;
const VALID_PERIOD_RANGE = /^((?:0[1-9]|1[0-2])\d{4})-((?:0[1-9]|1[0-2])\d{4})$/;
const SUMMARY_FIELDS = ["totalChecks", "matched", "mismatched", "exceptions", "highRisk", "totalAbsoluteDifference"];

function normalizeGstin(value) {
  return String(value || "").trim().toUpperCase();
}

export function matchingClientGstins(clientGstins, query) {
  const normalizedQuery = normalizeGstin(query);
  return [...(clientGstins || [])].filter((gstin) => normalizeGstin(gstin).includes(normalizedQuery));
}

export function clientGstinSearchTarget(clientGstins, query) {
  const normalizedQuery = normalizeGstin(query);
  if (!normalizedQuery) return null;
  const matches = matchingClientGstins(clientGstins, normalizedQuery);
  return matches.find((gstin) => normalizeGstin(gstin) === normalizedQuery) || matches[0] || null;
}

function periodsFor(reconciliation) {
  const result = reconciliation?.result || {};
  if (Array.isArray(result.periods) && result.periods.length) return result.periods;
  return result.returnPeriod ? [result] : [];
}

function periodSortValue(returnPeriod) {
  const start = String(returnPeriod || "").match(/^(0[1-9]|1[0-2])(\d{4})/) || [];
  return start.length ? Number(`${start[2]}${start[1]}`) : Number.MAX_SAFE_INTEGER;
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
      const range = String(periodResult.returnPeriod || "").match(VALID_PERIOD_RANGE);
      if (!VALID_PERIOD.test(periodResult.returnPeriod || "") && !range) continue;
      const gstin = clientGstinForPeriod(reconciliation, periodResult);
      if (!gstin) continue;
      const sortPeriod = range ? range[1] : periodResult.returnPeriod;
      const year = sortPeriod.slice(2);
      if (!grouped.has(gstin)) grouped.set(gstin, new Map());
      const clientYears = grouped.get(gstin);
      if (!clientYears.has(year)) clientYears.set(year, new Map());
      const periodResults = clientYears.get(year);
      if (!periodResults.has(periodResult.returnPeriod)) {
        periodResults.set(periodResult.returnPeriod, {
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
    Object.fromEntries([...years.entries()].map(([year, periods]) => [
      year,
      [...periods.values()].sort((left, right) => periodSortValue(left.returnPeriod) - periodSortValue(right.returnPeriod)),
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
    exportScope: { year },
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
      methodology: `Latest saved reconciliation for each available filed return period in ${year}.`,
    },
  };
}
