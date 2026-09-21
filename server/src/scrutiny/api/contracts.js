// Wire contracts use decimal strings for amounts to avoid JSON floating-point loss.
export const AUDIT_SOURCE_ROLES = Object.freeze(["books_vouchers", "books_ledgers", "trial_balance", "prior_year_trial_balance", "ais"]);
export const AUDIT_CHECK_IDS = Object.freeze(["B01", "B02", "B03", "B04", "P01", "AIS01"]);
export const AUDIT_RUN_STATUSES = Object.freeze(["queued", "running", "completed", "failed"]);
export const AUDIT_RESULT_STATUSES = Object.freeze(["matched", "difference", "review", "insufficient_data"]);
export const AUDIT_REVIEW_DECISIONS = Object.freeze(["confirmed", "dismissed", "needs_follow_up"]);

const identifier = Object.freeze({ type: "string", minLength: 1, maxLength: 128 });
const dateTime = Object.freeze({ type: "string", format: "date-time" });
const decimal = Object.freeze({ type: "string", pattern: "^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?$" });
const fiscalYear = Object.freeze({ type: "string", pattern: "^\\d{4}-\\d{4}$", format: "fiscal-year" });
const sourceRole = Object.freeze({ type: "string", enum: AUDIT_SOURCE_ROLES });
const checkId = Object.freeze({ type: "string", enum: AUDIT_CHECK_IDS });

export const AUDIT_PARSED_SOURCE_SCHEMA = Object.freeze({
  type: "object", required: ["sourceId", "role", "originalName", "format", "financialYear", "taxpayerId", "status", "recordCount", "records", "issues"], additionalProperties: false,
  properties: {
    sourceId: identifier,
    role: sourceRole,
    originalName: { type: "string", minLength: 1 },
    format: { type: "string", minLength: 1 },
    financialYear: { ...fiscalYear, nullable: true },
    taxpayerId: { type: "string", nullable: true },
    status: { type: "string", enum: ["ready", "insufficient_data"] },
    completeExport: { type: "boolean" },
    recordCount: { type: "integer", minimum: 0 },
    records: { type: "array", items: { type: "object" } },
    issues: { type: "array", items: {
      type: "object", required: ["code", "message"], additionalProperties: false,
      properties: { code: { type: "string", minLength: 1 }, message: { type: "string", minLength: 1 }, rowNumber: { type: "integer", minimum: 1 } },
    } },
  },
});

export const CREATE_AUDIT_REPORT_REQUEST_SCHEMA = Object.freeze({
  type: "object", required: ["name", "fiscalYear"], additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 160 },
    fiscalYear,
  },
});

// Multipart upload supplies exactly one `file` part separately from these fields.
export const UPLOAD_AUDIT_SOURCE_METADATA_SCHEMA = Object.freeze({
  type: "object", required: ["role"], additionalProperties: false,
  properties: { role: sourceRole },
});

export const CREATE_AUDIT_RUN_REQUEST_SCHEMA = Object.freeze({
  type: "object", required: ["selectedSourceIds", "checkIds"], additionalProperties: false,
  properties: {
    selectedSourceIds: { type: "array", minItems: 1, uniqueItems: true, items: identifier },
    checkIds: { type: "array", minItems: 1, uniqueItems: true, items: checkId },
  },
});

export const AUDIT_REVIEW_DECISION_REQUEST_SCHEMA = Object.freeze({
  type: "object", required: ["decision"], additionalProperties: false,
  properties: {
    decision: { type: "string", enum: AUDIT_REVIEW_DECISIONS },
    note: { type: "string", maxLength: 2000 },
  },
});

export const AUDIT_REPORT_SCHEMA = Object.freeze({
  type: "object", required: ["id", "name", "fiscalYear", "createdAt", "updatedAt"], additionalProperties: false,
  properties: {
    id: identifier,
    name: { type: "string", minLength: 1, maxLength: 160 },
    fiscalYear,
    createdAt: dateTime,
    updatedAt: dateTime,
  },
});

export const AUDIT_SOURCE_SCHEMA = Object.freeze({
  type: "object", required: ["id", "reportId", "role", "originalName", "mimeType", "sizeBytes", "createdAt", "parseStatus"], additionalProperties: false,
  properties: {
    id: identifier,
    reportId: identifier,
    role: sourceRole,
    originalName: { type: "string", minLength: 1, maxLength: 255 },
    mimeType: { type: "string", minLength: 1, maxLength: 255 },
    sizeBytes: { type: "integer", minimum: 0 },
    createdAt: dateTime,
    parseStatus: { type: "string", enum: ["ready", "review", "insufficient_data", "failed"] },
    parseWarnings: { type: "array", items: { type: "string" } },
    parsed: { ...AUDIT_PARSED_SOURCE_SCHEMA, nullable: true },
  },
});

export const AUDIT_RUN_SCHEMA = Object.freeze({
  type: "object", required: ["id", "reportId", "status", "selectedSourceIds", "checkIds", "createdAt"], additionalProperties: false,
  properties: {
    id: identifier,
    reportId: identifier,
    status: { type: "string", enum: AUDIT_RUN_STATUSES },
    selectedSourceIds: { type: "array", minItems: 1, uniqueItems: true, items: identifier },
    checkIds: { type: "array", minItems: 1, uniqueItems: true, items: checkId },
    createdAt: dateTime,
    startedAt: { ...dateTime, nullable: true },
    completedAt: { ...dateTime, nullable: true },
    failure: { type: "string", nullable: true },
  },
});

export const AUDIT_RESULT_SCHEMA = Object.freeze({
  type: "object", required: ["id", "runId", "checkId", "status", "summary"], additionalProperties: false,
  properties: {
    id: identifier,
    runId: identifier,
    checkId,
    status: { type: "string", enum: AUDIT_RESULT_STATUSES },
    summary: { type: "string", minLength: 1 },
    expectedAmount: { ...decimal, nullable: true },
    actualAmount: { ...decimal, nullable: true },
    differenceAmount: { ...decimal, nullable: true },
    evidence: { type: "array", items: { type: "object" } },
    decision: { type: "string", enum: AUDIT_REVIEW_DECISIONS, nullable: true },
    decisionNote: { type: "string", nullable: true },
    decidedAt: { ...dateTime, nullable: true },
  },
});

export const SCRUTINY_RESPONSE_SCHEMAS = Object.freeze({
  createAuditReport: { type: "object", required: ["auditReport"], additionalProperties: false, properties: { auditReport: AUDIT_REPORT_SCHEMA } },
  listAuditReports: { type: "object", required: ["auditReports"], additionalProperties: false, properties: { auditReports: { type: "array", items: AUDIT_REPORT_SCHEMA } } },
  getAuditReport: { type: "object", required: ["auditReport", "sources", "runs"], additionalProperties: false, properties: {
    auditReport: AUDIT_REPORT_SCHEMA, sources: { type: "array", items: AUDIT_SOURCE_SCHEMA }, runs: { type: "array", items: AUDIT_RUN_SCHEMA },
  } },
  uploadAuditSource: { type: "object", required: ["source"], additionalProperties: false, properties: { source: AUDIT_SOURCE_SCHEMA } },
  getAuditSource: { type: "object", required: ["source"], additionalProperties: false, properties: { source: AUDIT_SOURCE_SCHEMA } },
  createAuditRun: { type: "object", required: ["run"], additionalProperties: false, properties: { run: AUDIT_RUN_SCHEMA } },
  getAuditRun: { type: "object", required: ["run"], additionalProperties: false, properties: { run: AUDIT_RUN_SCHEMA } },
  listAuditResults: { type: "object", required: ["results"], additionalProperties: false, properties: { results: { type: "array", items: AUDIT_RESULT_SCHEMA } } },
  reviewAuditResult: { type: "object", required: ["result"], additionalProperties: false, properties: { result: AUDIT_RESULT_SCHEMA } },
});
