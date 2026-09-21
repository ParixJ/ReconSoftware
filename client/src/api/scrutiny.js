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
];

export const AUDIT_CHECKS = [
  ["B01", "Voucher balance"],
  ["B02", "Ledger roll-forward"],
  ["B03", "Trial balance"],
  ["B04", "Dormant balances"],
  ["P01", "Prior-year comparison"],
  ["AIS01", "AIS income comparison"],
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

export function buildSourceUploadForm(file, role, completeExport) {
  const form = new FormData();
  form.append("file", file);
  form.append("role", role);
  form.append("completeExport", String(Boolean(completeExport)));
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
  uploadSource: (reportId, file, role, completeExport) => api.post(
    `${reportPath(reportId)}/sources`, buildSourceUploadForm(file, role, completeExport),
  ),
  getSource: (reportId, sourceId) => api.get(sourcePath(reportId, sourceId)),
  getSourceFile: (reportId, sourceId) => api.get(`${sourcePath(reportId, sourceId)}/file`, { responseType: "blob" }),
  createRun: (reportId, selectedSourceIds, checkIds) => api.post(
    `${reportPath(reportId)}/runs`, buildRunRequest(selectedSourceIds, checkIds),
  ),
  getRun: (reportId, runId) => api.get(runPath(reportId, runId)),
  getResults: (reportId, runId) => api.get(`${runPath(reportId, runId)}/results`),
  setDecision: (reportId, runId, resultId, decision, note) => api.put(
    `${runPath(reportId, runId)}/results/${segment(resultId)}/decision`,
    { decision, note: note.trim() },
  ),
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
