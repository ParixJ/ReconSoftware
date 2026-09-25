// Wire contracts use decimal strings for amounts to avoid JSON floating-point loss.
export const AUDIT_SOURCE_ROLES = Object.freeze(["books_vouchers", "books_ledgers", "trial_balance", "prior_year_trial_balance", "ais", "supporting_document"]);
export const AUDIT_CHECK_IDS = Object.freeze(["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08", "B09", "B10", "B11", "B20", "P01", "P02", "AIS01", "AIS02", "A26", "G01", "G02", "S01", "T03", "T09", "X01"]);
export const AUDIT_RUN_STATUSES = Object.freeze(["queued", "running", "completed", "failed"]);
export const AUDIT_RESULT_STATUSES = Object.freeze(["matched", "difference", "review", "insufficient_data"]);
export const AUDIT_REVIEW_DECISIONS = Object.freeze(["confirmed", "dismissed", "needs_follow_up"]);

const identifier = Object.freeze({ type: "string", minLength: 1, maxLength: 128 });
const dateTime = Object.freeze({ type: "string", format: "date-time" });
const decimal = Object.freeze({ type: "string", pattern: "^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?$" });
const fiscalYear = Object.freeze({ type: "string", pattern: "^\\d{4}-\\d{4}$", format: "fiscal-year" });
const sourceRole = Object.freeze({ type: "string", enum: AUDIT_SOURCE_ROLES });
const checkId = Object.freeze({ type: "string", enum: AUDIT_CHECK_IDS });
const auditRunParameters = Object.freeze({
  type: "object", additionalProperties: false,
  properties: { duplicateVoucherMinAmount: decimal },
});

export const AUDIT_PARSED_SOURCE_SCHEMA = Object.freeze({
  type: "object", required: ["sourceId", "role", "originalName", "format", "financialYear", "taxpayerId", "status", "recordCount", "records", "issues"], additionalProperties: false,
  properties: {
    sourceId: identifier,
    role: sourceRole,
    originalName: { type: "string", minLength: 1 },
    format: { type: "string", minLength: 1 },
    financialYear: { ...fiscalYear, nullable: true },
    coverageYears: { type: "array", items: fiscalYear },
      taxpayerId: { type: "string", nullable: true },
      identityCandidates: { type: "array", items: { type: "object" } },
      labelAliasVersion: { type: "integer", minimum: 1 },
      unclassifiedSections: { type: "array", items: { type: "object" } },
      rejectedRows: { type: "array", items: { type: "object" } },
      status: { type: "string", enum: ["ready", "review", "insufficient_data"] },
    completeExport: { type: "boolean" },
    parseWarnings: { type: "array", items: { type: "string" } },
    documentType: { type: "string", nullable: true },
    ocrUsed: { type: "boolean" },
    pageCount: { type: "integer", minimum: 1 },
      textLines: { type: "array", items: { type: "object" } },
      ocrTextLines: { type: "array", items: { type: "object" } },
    entityName: { type: "string", nullable: true },
    recordCount: { type: "integer", minimum: 0 },
    records: { type: "array", items: { type: "object" } },
    rawRows: { type: "array", items: { type: "object" } },
    mappingProfile: { type: "object" },
    ledgerStatements: { type: "array", items: { type: "object" } },
    tables: { type: "array", items: { type: "object" } },
    issues: { type: "array", items: {
      type: "object", required: ["code", "message"], additionalProperties: false,
      properties: { code: { type: "string", minLength: 1 }, message: { type: "string", minLength: 1 },
        rowNumber: { type: "integer", minimum: 1 }, tableId: identifier,
        pageNumber: { type: "integer", minimum: 1 }, sourceRefs: { type: "array", items: { type: "object" } } },
    } },
  },
});

export const CREATE_AUDIT_REPORT_REQUEST_SCHEMA = Object.freeze({
  type: "object", required: ["name", "fiscalYear"], additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 160 },
    fiscalYear,
    taxpayerId: { type: "string", pattern: "^(?:[A-Z]{5}[0-9]{4}[A-Z]|[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9][A-Z])$" },
  },
});

// Multipart upload supplies exactly one `file` part separately from these fields.
export const UPLOAD_AUDIT_SOURCE_METADATA_SCHEMA = Object.freeze({
  type: "object", required: ["role"], additionalProperties: false,
  properties: { role: sourceRole, completeExport: { type: "boolean" }, profileId: identifier },
});

export const CREATE_AUDIT_PROFILE_REQUEST_SCHEMA = Object.freeze({
  type: "object", required: ["name", "role", "configuration"], additionalProperties: false,
  properties: { name: { type: "string", minLength: 1, maxLength: 120 }, role: sourceRole,
    configuration: { type: "object" } },
});

export const DERIVE_AUDIT_SOURCE_REQUEST_SCHEMA = Object.freeze({
  type: "object", required: ["fromSourceId", "completeExport"], additionalProperties: false,
  properties: { fromSourceId: identifier, profileId: identifier, completeExport: { type: "boolean" } },
});

export const CREATE_AUDIT_EXPORT_REQUEST_SCHEMA = Object.freeze({
  type: "object", required: ["runIds", "format", "grouping"], additionalProperties: false,
  properties: { runIds: { type: "array", minItems: 1, uniqueItems: true, items: identifier },
    format: { type: "string", enum: ["xlsx", "pdf"] },
    grouping: { type: "string", enum: ["consolidated", "by_fy"] } },
});

export const CREATE_AUDIT_RUN_REQUEST_SCHEMA = Object.freeze({
  type: "object", required: ["selectedSourceIds", "checkIds"], additionalProperties: false,
  properties: {
    selectedSourceIds: { type: "array", minItems: 1, uniqueItems: true, items: identifier },
    checkIds: { type: "array", minItems: 1, uniqueItems: true, items: checkId },
    parameters: auditRunParameters,
    idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
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
    taxpayerId: { type: "string", nullable: true },
    sourceCount: { type: "integer", minimum: 0 },
    runCount: { type: "integer", minimum: 0 },
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
    fileType: { type: "string", minLength: 1 },
    sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    parserVersion: { type: "string", minLength: 1 },
    sizeBytes: { type: "integer", minimum: 0 },
    createdAt: dateTime,
    parseStatus: { type: "string", enum: ["ready", "review", "insufficient_data", "failed"] },
    issues: { type: "array", items: { type: "object" } },
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
    parameters: auditRunParameters,
    createdAt: dateTime,
    startedAt: { ...dateTime, nullable: true },
    finishedAt: { ...dateTime, nullable: true },
    error: { type: "object", nullable: true },
    results: { type: "array", items: { type: "object" } },
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

export const AUDIT_PROFILE_SCHEMA = Object.freeze({
  type: "object", required: ["id", "name", "version", "role", "configuration", "status", "createdAt"],
  additionalProperties: false, properties: { id: identifier, name: { type: "string", minLength: 1 },
    version: { type: "integer", minimum: 1 }, role: sourceRole, configuration: { type: "object" },
    status: { type: "string", enum: ["pending", "approved"] }, createdAt: dateTime,
    approvedAt: { ...dateTime, nullable: true } },
});

export const AUDIT_EXPORT_SCHEMA = Object.freeze({
  type: "object", required: ["id", "runIds", "format", "grouping", "status", "createdAt"],
  additionalProperties: false, properties: { id: identifier,
    runIds: { type: "array", minItems: 1, items: identifier },
    format: { type: "string", enum: ["xlsx", "pdf"] },
    grouping: { type: "string", enum: ["consolidated", "by_fy"] },
    status: { type: "string", enum: ["queued", "running", "completed", "failed"] },
    createdAt: dateTime, finishedAt: { ...dateTime, nullable: true },
    error: { type: "object", nullable: true } },
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
  listAuditResults: { type: "object", required: ["results", "reviews"], additionalProperties: false, properties: {
    results: { type: "array", items: AUDIT_RESULT_SCHEMA }, reviews: { type: "array", items: { type: "object" } },
  } },
  reviewAuditResult: { type: "object", required: ["review"], additionalProperties: false, properties: { review: { type: "object" } } },
  listAuditProfiles: { type: "object", required: ["profiles"], additionalProperties: false,
    properties: { profiles: { type: "array", items: AUDIT_PROFILE_SCHEMA } } },
  auditProfile: { type: "object", required: ["profile"], additionalProperties: false,
    properties: { profile: AUDIT_PROFILE_SCHEMA } },
  sourceRows: { type: "object", required: ["rows", "total", "offset", "limit"], additionalProperties: false,
    properties: { rows: { type: "array", items: { type: "object" } },
      total: { type: "integer", minimum: 0 }, offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1 } } },
  comparisonRows: { type: "object", required: ["rows", "total", "offset", "limit"], additionalProperties: false,
    properties: { rows: { type: "array", items: { type: "object" } },
      total: { type: "integer", minimum: 0 }, offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1 } } },
  sourcePreflight: { type: "object", required: ["preflight"], additionalProperties: false,
    properties: { preflight: { type: "object", required: ["sourceId", "parseStatus", "issues", "previewRows", "proposedRoles"],
      properties: { sourceId: identifier, parseStatus: { type: "string" }, issues: { type: "array", items: { type: "object" } },
        originalFieldNames: { type: "array", items: { type: "string" } },
        previewRows: { type: "array", items: { type: "object" } },
        proposedRoles: { type: "array", items: { type: "object" } } } } } },
  auditExport: { type: "object", required: ["export"], additionalProperties: false,
    properties: { export: AUDIT_EXPORT_SCHEMA } },
});
