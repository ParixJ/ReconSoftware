import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_CHECK_IDS, AUDIT_RESULT_SCHEMA, AUDIT_SOURCE_ROLES,
  CREATE_AUDIT_REPORT_REQUEST_SCHEMA, CREATE_AUDIT_RUN_REQUEST_SCHEMA,
  SCRUTINY_RESPONSE_SCHEMAS,
} from "../src/scrutiny/api/contracts.js";
import {
  auditSchemaIssues, validateAuditReviewDecisionRequest, validateCreateAuditReportRequest,
  validateCreateAuditRunRequest, validateScrutinyResponse, validateUploadAuditSourceMetadata,
} from "../src/scrutiny/api/validators.js";

function rejectedWith(code, fn) {
  assert.throws(fn, (error) => error.status === 400 && error.code === code && Array.isArray(error.details?.issues));
}

test("request contracts expose only the agreed scrutiny roles and checks", () => {
  assert.deepEqual(AUDIT_SOURCE_ROLES, ["books_vouchers", "books_ledgers", "trial_balance", "prior_year_trial_balance", "ais", "supporting_document"]);
  assert.deepEqual(AUDIT_CHECK_IDS, ["B01", "B02", "B03", "B04", "B05", "B06", "B07", "B08", "B09", "B10", "B11", "B20", "P01", "P02", "AIS01", "AIS02", "A26", "G01", "G02", "S01", "T03", "T09", "X01"]);
  assert.deepEqual(CREATE_AUDIT_REPORT_REQUEST_SCHEMA.required, ["name", "fiscalYear"]);
  assert.deepEqual(CREATE_AUDIT_RUN_REQUEST_SCHEMA.required, ["selectedSourceIds", "checkIds"]);
});

test("report creation trims names and rejects invalid fiscal years and ownership input", () => {
  assert.deepEqual(validateCreateAuditReportRequest({ name: "  FY audit  ", fiscalYear: "2024-2025" }), { name: "FY audit", fiscalYear: "2024-2025" });
  for (const fiscalYear of ["2024", "2024-2026", "2024-2024", "9999-0000"]) {
    rejectedWith("INVALID_AUDIT_REPORT", () => validateCreateAuditReportRequest({ name: "Audit", fiscalYear }));
  }
  rejectedWith("INVALID_AUDIT_REPORT", () => validateCreateAuditReportRequest({ name: "  ", fiscalYear: "2024-2025" }));
  rejectedWith("INVALID_AUDIT_REPORT", () => validateCreateAuditReportRequest({ name: "Audit", fiscalYear: "2024-2025", ownerId: "another-user" }));
});

test("source metadata and run selection reject unsupported, empty, duplicate and extra values", () => {
  assert.deepEqual(validateUploadAuditSourceMetadata({ role: "ais" }), { role: "ais" });
  rejectedWith("INVALID_AUDIT_SOURCE_ROLE", () => validateUploadAuditSourceMetadata({ role: "bank_statement" }));
  rejectedWith("INVALID_AUDIT_SOURCE_ROLE", () => validateUploadAuditSourceMetadata({ role: "ais", reportId: "other" }));
  const selection = { selectedSourceIds: ["source-1", "source-2"], checkIds: ["B01", "AIS01"] };
  assert.deepEqual(validateCreateAuditRunRequest(selection), selection);
  const parameterized = { ...selection, parameters: { duplicateVoucherMinAmount: "25000.00" } };
  assert.deepEqual(validateCreateAuditRunRequest(parameterized), parameterized);
  rejectedWith("INVALID_AUDIT_SELECTION", () => validateCreateAuditRunRequest({ selectedSourceIds: [], checkIds: ["B01"] }));
  rejectedWith("INVALID_AUDIT_SELECTION", () => validateCreateAuditRunRequest({ selectedSourceIds: ["s", "s"], checkIds: ["B01"] }));
  rejectedWith("INVALID_AUDIT_SELECTION", () => validateCreateAuditRunRequest({ selectedSourceIds: ["s"], checkIds: ["B99"] }));
  rejectedWith("INVALID_AUDIT_SELECTION", () => validateCreateAuditRunRequest({ selectedSourceIds: ["s"], checkIds: ["B01"],
    parameters: { duplicateVoucherMinAmount: "-1.00" } }));
  rejectedWith("INVALID_AUDIT_SELECTION", () => validateCreateAuditRunRequest({ selectedSourceIds: ["s"], checkIds: ["B01"],
    parameters: { duplicateVoucherMinAmount: "1.001" } }));
  rejectedWith("INVALID_AUDIT_SELECTION", () => validateCreateAuditRunRequest({ selectedSourceIds: ["s"], checkIds: ["B01"], ownerId: "other" }));
});

test("review decisions are bounded and cannot set reviewer identity", () => {
  assert.deepEqual(validateAuditReviewDecisionRequest({ decision: "needs_follow_up", note: "  inspect invoice  " }), { decision: "needs_follow_up", note: "inspect invoice" });
  rejectedWith("INVALID_AUDIT_DECISION", () => validateAuditReviewDecisionRequest({ decision: "approved" }));
  rejectedWith("INVALID_AUDIT_DECISION", () => validateAuditReviewDecisionRequest({ decision: "confirmed", reviewerId: "other" }));
  rejectedWith("INVALID_AUDIT_DECISION", () => validateAuditReviewDecisionRequest({ decision: "confirmed", note: "x".repeat(2001) }));
});

test("response contracts enforce decimal strings, status enums and common envelopes", () => {
  const auditReport = { id: "r1", name: "Audit", fiscalYear: "2024-2025", createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:00:00.000Z" };
  assert.equal(validateScrutinyResponse("createAuditReport", { auditReport }).auditReport.id, "r1");
  assert.equal(validateScrutinyResponse("listAuditReports", { auditReports: [] }).auditReports.length, 0);
  assert.deepEqual(auditSchemaIssues(AUDIT_RESULT_SCHEMA, { id: "f1", runId: "run1", checkId: "B01", status: "difference", summary: "Unbalanced", differenceAmount: "0.01" }), []);
  assert.ok(auditSchemaIssues(AUDIT_RESULT_SCHEMA, { id: "f1", runId: "run1", checkId: "B01", status: "difference", summary: "Unbalanced", differenceAmount: 0.01 }).some((entry) => entry.path === "$.differenceAmount"));
  assert.ok(auditSchemaIssues(AUDIT_RESULT_SCHEMA, { id: "f1", runId: "run1", checkId: "B01", status: "pass", summary: "Fine" }).some((entry) => entry.path === "$.status"));
  assert.throws(() => validateScrutinyResponse("createAuditReport", { auditReport, ownerId: "other" }), TypeError);
  assert.throws(() => validateScrutinyResponse("unknown", {}), TypeError);
  assert.ok(SCRUTINY_RESPONSE_SCHEMAS.getAuditReport);
});

test("source detail preserves parsed provenance and identifies incomplete exports", () => {
  const source = {
    id: "s1", reportId: "r1", role: "books_vouchers", originalName: "books.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: 2048,
    createdAt: "2026-09-22T00:00:00.000Z", parseStatus: "insufficient_data",
    parsed: {
      sourceId: "s1", role: "books_vouchers", originalName: "books.xlsx", format: "xlsx",
      financialYear: "2024-2025", taxpayerId: null, status: "insufficient_data", completeExport: false,
      recordCount: 0, records: [], issues: [{ code: "MISSING_POSTINGS", message: "No postings found", rowNumber: 2 }],
    },
  };
  assert.equal(validateScrutinyResponse("getAuditSource", { source }).source.parseStatus, "insufficient_data");
  const invalid = structuredClone(source);
  invalid.parsed.issues[0].rowNumber = 0;
  assert.throws(() => validateScrutinyResponse("getAuditSource", { source: invalid }), TypeError);
  const badTimestamp = structuredClone(source);
  badTimestamp.createdAt = "2026-02-31T00:00:00Z";
  assert.throws(() => validateScrutinyResponse("getAuditSource", { source: badTimestamp }), TypeError);
});
