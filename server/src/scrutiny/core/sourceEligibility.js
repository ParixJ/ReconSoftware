// Parsing status describes the whole upload. A check may use extracted records
// despite incomplete coverage, but never when the source identity or period is
// contradicted. Such results must remain provisional rather than a clean match.
const BLOCKING_ISSUES = new Set([
  "UNSUPPORTED_AUDIT_FORMAT", "INVALID_AUDIT_SOURCE", "AUDIT_SOURCE_ROLE_MISMATCH",
  "AIS_PDF_NOT_DETECTED", "AUDIT_SUPPORT_DOCUMENT_UNKNOWN",
  "AUDIT_TAXPAYER_MISMATCH", "AUDIT_IDENTITY_CONFLICT", "AUDIT_IDENTITY_NOT_FOUND",
  "AUDIT_MULTIPLE_ENTITIES", "AUDIT_PERIOD_MISMATCH", "AUDIT_PERIOD_CONFLICT",
  "AUDIT_PERIOD_UNREADABLE", "AUDIT_GST_LEDGER_PERIOD_UNREADABLE",
  "AUDIT_GST_LEDGER_DATE_OUT_OF_PERIOD",
]);
const CONFLICTING_ISSUES = new Set([
  "AUDIT_TAXPAYER_MISMATCH", "AUDIT_IDENTITY_CONFLICT", "AUDIT_MULTIPLE_ENTITIES",
  "AUDIT_PERIOD_MISMATCH", "AUDIT_PERIOD_CONFLICT", "AUDIT_GST_LEDGER_DATE_OUT_OF_PERIOD",
]);

export const hasConflictingSourceIssue = (source) =>
  Boolean(source?.issues?.some((issue) => CONFLICTING_ISSUES.has(issue.code)));

export const hasBlockingSourceIssue = (source) =>
  Boolean(source?.issues?.some((issue) => BLOCKING_ISSUES.has(issue.code)));

export function sourceEligibility(source) {
  if (!source || !Array.isArray(source.records) || !source.records.length) return "unusable";
  if (hasBlockingSourceIssue(source)) return "unusable";
  if (source.status === "ready") return source.completeExport === false ? "provisional" : "ready";
  if (!["review", "insufficient_data"].includes(source.status) ||
      !Array.isArray(source.issues) || !source.issues.length ||
      source.issues.some((issue) => !issue?.code || BLOCKING_ISSUES.has(issue.code))) return "unusable";
  return "provisional";
}

export function provisionalResult(result, sources) {
  if (result.status === "insufficient_data" || result.evidence?.some((row) => row.kind === "source_limitation")) return result;
  const incomplete = sources.filter((source) => sourceEligibility(source) === "provisional");
  if (!incomplete.length) return result;
  return { ...result, status: "review",
    summary: `${result.summary} Provisional: selected source extraction or coverage is incomplete.`,
    evidence: [...(result.evidence || []), ...incomplete.map((source) => ({
      kind: "source_limitation", sourceId: source.sourceId,
      issues: (source.issues?.length ? source.issues : [{ code: "AUDIT_EXPORT_COMPLETENESS_UNCONFIRMED",
        message: "The source does not confirm complete period coverage." }]).map((issue) => ({ code: issue.code, message: issue.message,
        ...(issue.rowNumber ? { rowNumber: issue.rowNumber } : {}) })),
    }))] };
}
