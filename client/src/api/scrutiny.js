import { api } from "./client.js";

const base = "/scrutiny/audit-reports";
const segment = (value) => encodeURIComponent(String(value));
const reportPath = (reportId) => `${base}/${segment(reportId)}`;
const sourcePath = (reportId, sourceId) => `${reportPath(reportId)}/sources/${segment(sourceId)}`;
const runPath = (reportId, runId) => `${reportPath(reportId)}/runs/${segment(runId)}`;

export const SOURCE_ROLES = [
  ["books_vouchers", "Books · vouchers"],
  ["books_ledgers", "Books · ledgers"],
  ["trial_balance", "Trial balance"],
  ["prior_year_trial_balance", "Prior-year trial balance"],
  ["ais", "AIS"],
  ["supporting_document", "Supporting document · auto-detect"],
];

export const SUPPORTING_DOCUMENT_TYPES = [
  ["", "Auto-detect known PDF/XLSX support"],
  ["prior_year_report", "Prior-year audit report"],
  ["msme_register", "MSME register / payment ageing"],
  ["bank_statement", "Bank statement"],
  ["loan_schedule", "Loan schedule"],
  ["stock_report", "Stock report"],
  ["tax_challan", "Tax / GST-TDS challans"],
  ["tds_rules", "TDS rules / overrides"],
];

export const AUDIT_CHECKS = [
  ["B01", "Voucher balance"],
  ["B02", "Ledger roll-forward"],
  ["B03", "Trial balance"],
  ["B04", "Dormant balances"],
  ["B05", "Negative cash balance"],
  ["B06", "Suspense balance"],
  ["B07", "Debtor/creditor balance sign"],
  ["B08", "Potential duplicate vouchers"],
  ["B09", "Pending GST ledger balance"],
  ["B10", "Insurance/prepaid classification"],
  ["B11", "Prepaid reversal review"],
  ["B20", "Voucher versus ledger-export coverage"],
  ["P01", "Prior-year comparison"],
  ["P02", "Year-on-year ledger changes"],
  ["PY01", "Prior-year report disclosures"],
  ["AIS01", "AIS income comparison"],
  ["AIS02", "AIS GST-turnover control"],
  ["A26", "AIS versus Form 26AS candidates"],
  ["G01", "GST portal-ledger roll-forward"],
  ["G02", "Books versus GST cash ledger"],
  ["G03", "GST cash/credit books versus portal"],
  ["S01", "Product quantity roll-forward"],
  ["S02", "Stock risk review"],
  ["BK01", "Bank statement review"],
  ["L01", "Loan schedule review"],
  ["M01", "MSME payment ageing"],
  ["AT01", "Advance-tax / challan review"],
  ["T03", "TDS/TCS book-credit review"],
  ["T09", "Refund reference review"],
  ["TDS01", "TDS auditor applicability"],
  ["X01", "Books versus supporting sources"],
];

export const REVIEW_DECISIONS = [
  ["confirmed", "Confirmed"],
  ["dismissed", "Dismissed"],
  ["needs_follow_up", "Needs follow-up"],
];

export function buildReportRequest({ name, fiscalYear, taxpayerId }) {
  return {
    name: name.trim(),
    fiscalYear: fiscalYear.trim(),
    ...(taxpayerId?.trim() ? { taxpayerId: taxpayerId.trim().toUpperCase() } : {}),
  };
}

export function buildSourceUploadForm(file, role, completeExport, profileId = "", documentType = "") {
  const form = new FormData();
  form.append("file", file);
  form.append("role", role);
  form.append("completeExport", String(Boolean(completeExport)));
  if (profileId) form.append("profileId", profileId);
  if (documentType) form.append("documentType", documentType);
  return form;
}

export function buildRunRequest(selectedSourceIds, checkIds) {
  return {
    selectedSourceIds,
    checkIds,
    ...(globalThis.crypto?.randomUUID ? { idempotencyKey: globalThis.crypto.randomUUID() } : {}),
  };
}

export const scrutinyApi = {
  listReports: () => api.get(base),
  createReport: (values) => api.post(base, buildReportRequest(values)),
  getReport: (reportId) => api.get(reportPath(reportId)),
  uploadSource: (reportId, file, role, completeExport, profileId, documentType) => api.post(
    `${reportPath(reportId)}/sources`, buildSourceUploadForm(file, role, completeExport, profileId, documentType),
    { timeout: 180000 },
  ),
  getSource: (reportId, sourceId) => api.get(sourcePath(reportId, sourceId)),
  getSourceFile: (reportId, sourceId) => api.get(`${sourcePath(reportId, sourceId)}/file`, { responseType: "blob" }),
  getSourceRows: (reportId, sourceId, collection = "rawRows", offset = 0, limit = 100) => api.get(
    `${sourcePath(reportId, sourceId)}/rows`, { params: { collection, offset, limit } }),
  getSourcePreflight: (reportId, sourceId) => api.get(`${sourcePath(reportId, sourceId)}/preflight`),
  listSourceLibrary: () => api.get(`${base}/source-library`),
  listProfiles: () => api.get(`${base}/mapping-profiles`),
  createProfile: (values) => api.post(`${base}/mapping-profiles`, values),
  approveProfile: (profileId) => api.post(`${base}/mapping-profiles/${segment(profileId)}/approve`),
  deriveSource: (reportId, values) => api.post(`${reportPath(reportId)}/sources/derive`, values),
  createRun: (reportId, selectedSourceIds, checkIds) => api.post(
    `${reportPath(reportId)}/runs`, buildRunRequest(selectedSourceIds, checkIds),
  ),
  getRun: (reportId, runId) => api.get(runPath(reportId, runId)),
  getResults: (reportId, runId) => api.get(`${runPath(reportId, runId)}/results`),
  getComparisons: (reportId, runId, offset = 0, limit = 100) => api.get(
    `${runPath(reportId, runId)}/comparisons`, { params: { offset, limit } }),
  setDecision: (reportId, runId, resultId, decision, note) => api.put(
    `${runPath(reportId, runId)}/results/${segment(resultId)}/decision`,
    { decision, note: note.trim() },
  ),
  createExport: (runIds, format, grouping) => api.post(`${base}/exports`, { runIds, format, grouping }),
  getExport: (exportId) => api.get(`${base}/exports/${segment(exportId)}`),
  getExportFile: (exportId) => api.get(`${base}/exports/${segment(exportId)}/file`, { responseType: "blob" }),
};

export function isTerminalRun(status) {
  return status === "completed" || status === "failed";
}

export function parsedRows(parsed) {
  return (Array.isArray(parsed?.records) ? parsed.records : []).map((record) =>
    record && typeof record === "object" && !Array.isArray(record) ? record : { value: record },
  );
}

export function parsedFields(parsed) {
  return [...new Set(parsedRows(parsed).flatMap((record) => Object.keys(record)))];
}

export function latestReviewFor(reviews, resultId) {
  return reviews.reduce((latest, review) => {
    if (review.resultId !== resultId) return latest;
    if (!latest || String(review.createdAt || "") >= String(latest.createdAt || "")) return review;
    return latest;
  }, null);
}
