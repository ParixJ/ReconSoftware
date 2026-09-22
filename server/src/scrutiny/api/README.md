# Scrutiny audit-report API contract

All paths are under `/api/scrutiny/audit-reports` and require the existing session authentication. The server derives ownership from the session; clients must not submit an owner or reviewer ID. IDs in nested paths must belong to the same user-owned report. Successful JSON payloads use resource envelopes; failures use the shared `{ "error": { "code": "...", "message": "...", "details": ... } }` envelope.

| Method and path | Request | Successful response |
| --- | --- | --- |
| `POST /` | `{ "name": "FY audit", "fiscalYear": "2024-2025", "taxpayerId": "optional PAN or GSTIN" }` | `201 { "auditReport": AuditReport }` |
| `GET /` | none | `200 { "auditReports": AuditReport[] }` |
| `GET /:reportId` | none | `200 { "auditReport": AuditReport, "sources": AuditSource[], "runs": AuditRun[] }` |
| `POST /:reportId/sources` | multipart with one `file`, a `role` field, and `completeExport=true/false` | `201 { "source": AuditSource }` |
| `GET /:reportId/sources/:sourceId` | none | `200 { "source": AuditSource }`, including `source.parsed` when available |
| `GET /:reportId/sources/:sourceId/file` | none | `200` original file bytes with stored `Content-Type` and `Cache-Control: no-store` (not JSON) |
| `POST /:reportId/runs` | `{ "selectedSourceIds": ["source-id"], "checkIds": ["B01"], "idempotencyKey": "optional-key" }` | `202 { "run": AuditRun }` |
| `GET /:reportId/runs/:runId` | none | `200 { "run": AuditRun }` |
| `GET /:reportId/runs/:runId/results` | none | `200 { "results": AuditResult[], "reviews": AuditReview[] }` |
| `PUT /:reportId/runs/:runId/results/:resultId/decision` | `{ "decision": "needs_follow_up", "note": "Inspect original voucher" }` | `200 { "review": AuditReview }` |

`AuditReport` has `id`, `name`, optional `taxpayerId` (PAN or GSTIN), consecutive `fiscalYear` (`YYYY-YYYY`), `createdAt`, and `updatedAt`. Timestamps are ISO UTC. `AuditSource` includes `id`, `reportId`, `role`, `originalName`, `mimeType`, `fileType`, `sizeBytes`, `sha256`, `parserVersion`, `createdAt`, `parseStatus`, and parsing issues. Supported roles are `books_vouchers`, `books_ledgers`, `trial_balance`, `prior_year_trial_balance`, and `ais`. Upload one file at a time, at most 25 MB. Declare `completeExport=true` only for a complete source; without it, clean matches are withheld. The parser produces `source.parsed` with normalized records and provenance. PDF uploads are evidence-only and remain `insufficient_data` until a validated adapter exists.

`AuditRun` has `id`, `reportId`, `status`, selected source IDs, check IDs, and `createdAt`; it may include `startedAt`, `finishedAt`, `error`, and results on detail fetch. Status is `queued`, `running`, `completed`, or `failed`. Check IDs are `B01`, `B02`, `B03`, `B04`, `P01`, `AIS01`, and `AIS02`. AIS02 compares AIS `EXC-GSTR3B` GST-turnover entries with explicitly tagged book taxable values; a difference calls for review rather than a statutory conclusion. A run is an immutable selection snapshot; an optional `idempotencyKey` prevents duplicate creation for a repeated command. Starting another run does not overwrite earlier findings or reviewer decisions.

`AuditResult` has `id`, `runId`, `checkId`, `status`, and `summary`. Status is `matched`, `difference`, `review`, or `insufficient_data`. Optional `expectedAmount`, `actualAmount`, and `differenceAmount` are decimal strings, never JSON numbers. Evidence points to source records. Reviewer decisions are append-only `AuditReview` events (`confirmed`, `dismissed`, or `needs_follow_up`); the server, not the request, supplies reviewer identity and decision time. Missing or incomplete comparison data must result in `insufficient_data`, never a synthetic match.

Input validation rejects unknown fields, unsupported roles/checks/decisions, empty or duplicate selections, invalid fiscal years, and oversized names/notes. Route handlers must also verify that every selected source belongs to the report and authenticated user, and that a decision targets a result belonging to the specified run. The contract validators do not replace those persistence checks.

The original-file endpoint must apply the same report/source ownership lookup before reading its stored path. It must use only the server-persisted path, not a client path, and send `Content-Disposition` safely for the original filename. It is an evidence preview/download route; no OCR or parsed-value guarantee is implied for PDFs.

The shared error catalog registers `INVALID_AUDIT_REPORT`, `INVALID_AUDIT_SOURCE_ROLE`, `INVALID_AUDIT_SELECTION`, and `INVALID_AUDIT_DECISION` for request validation; `AUDIT_REPORT_NOT_FOUND`, `AUDIT_SOURCE_NOT_FOUND`, `AUDIT_RUN_NOT_FOUND`, and `AUDIT_RESULT_NOT_FOUND` for nested lookup failures; and `AUDIT_SOURCE_INVALID`, `AUDIT_SOURCE_INCOMPLETE`, and `AUDIT_RUN_FAILED` for processing failures. Existing authentication, upload-limit, and database-busy codes continue to apply. Validation errors include `details.issues` with `path` and `message` fields.
