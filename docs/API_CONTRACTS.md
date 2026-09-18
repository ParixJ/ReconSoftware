# API contracts

All JSON errors have this shape:

```json
{ "error": { "code": "MACHINE_CODE", "message": "Actionable message" } }
```

Authentication uses the `gst_session` HTTP-only cookie.

| Method | Endpoint | Auth | Contract |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | No | `{name,email,password}` → `{user}` |
| POST | `/api/auth/login` | No | `{email,password}` → `{user}` |
| GET | `/api/auth/me` | Yes | → `{user}` |
| POST | `/api/auth/logout` | Yes | → `204` |
| GET | `/api/sales/documents` | Yes | → `{documents[]}` without parsed rows |
| POST | `/api/sales/documents/upload` | Yes | multipart `files` (1–10) → `{documents[], errors[]}` |
| GET | `/api/sales/documents/:id` | Yes | → `{document}` including normalized rows/source fields |
| GET | `/api/sales/document-org/:id` | Yes | Re-extracts the owned source file → `{document}` with `original:{fields[],rows[],rowCount,extractionVersion}` and no normalized `parsed` payload |
| DELETE | `/api/sales/documents` | Yes | `{documentIds:[1–100]}` → `{deletedIds[],errors[]}`; returns `207` when only part of the selection could be removed |
| PUT | `/api/sales/documents/gstin` | Yes | `{documentIds:[1–100],gstin}` → `{documents[]}`; applies the validated client GSTIN to each selected document mapping |
| DELETE | `/api/sales/documents/:id` | Yes | Removes the owned document metadata and uploaded file → `204` |
| PUT | `/api/sales/documents/:id/mapping` | Yes | `{documentType,gstin,returnPeriod,fieldMap}` → `{document}` |
| PUT | `/api/sales/documents/:id/view-preference` | Yes | `{mode:"original"|"hidden"}` → `{document}` |
| POST | `/api/sales/reconciliations` | Yes | `{documentIds,amountTolerance,dateToleranceDays}` → `{reconciliation}`; returns `422 CLIENT_GSTIN_REQUIRED` when no selected document identifies the client and `422 CLIENT_GSTIN_MISMATCH` when selected documents identify different clients |
| GET | `/api/sales/reconciliations` | Yes | → `{reconciliations[]}` |
| GET | `/api/sales/reconciliations/export?gstin=:gstin&fiscalYear=:YYYY-YYYY&filename=:name&format=excel` | Yes | Downloads the latest monthly reconciliations for the client fiscal year as the two-sheet `GST_Reconciliation_*.xlsx` template; legacy `year=:YYYY` remains accepted |
| GET | `/api/sales/reconciliations/:id` | Yes | → `{reconciliation}` |

Supported `documentType` values are `gstr1`, `gstr2`, `gstr2b`, `gstr3b`, `salesRegister`, and `unknown`. `fieldMap` keys are restricted to the server's canonical columns.

Bulk GSTIN insertion accepts only the GSTIN format `NNAAAAANNNNAZN`, matching `/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i`.

The Home document viewer uses `GET /api/sales/document-org/:id`, not normalized reconciliation rows. `original.fields` comes from the owner-scoped `document_org` metadata row and is reconciled with newly discovered source fields during extraction. Existing documents without metadata are backfilled on their first original-view request.

`POST /api/sales/reconciliations` requires at least one GSTR-1 and one GSTR-3B. Before saving, the server cross-examines every detected client GSTIN in the authoritative selection. If none of the selected documents identifies a client GSTIN, the request is rejected without saving. Different known GSTINs also reject the whole request. Partial missing GSTINs remain resolvable mapping exceptions, but comparisons involving those unverified documents are withheld. Successful results include `result.crossExamination` with `{status,canReconcile,clientGstin,documentCount,identifiedCount,gstinGroups[],missingDocuments[]}`. Returns are grouped by `returnPeriod`; values are not aggregated across months. Each `result.periods[]` entry contains `{returnPeriod,clientGstin,status,documents[],summary,comparisons[],exceptions[],suggestions[]}`. Selected `salesRegister` documents add books-to-GSTR-1 and books-to-GSTR-3B checks for each matching monthly bucket; selected GSTR-2/GSTR-2B documents add ITC checks for their matching month.

Reconciliation exceptions include `{id,code,rootField,severity,message,suggestion,documentId?,rowIndex?}`. `GET /api/sales/reconciliations` and `GET /api/sales/reconciliations/:id` return active exceptions evaluated against the documents' current mappings; resolved exceptions are omitted.

## Imported sales endpoints

All sales endpoints are mounted under `/api/sales` and require the shared authenticated session. The machine-readable contract and error response schema are in `server/src/api/contracts.js`; error and exception codes are in `server/src/api/errorCodes.js`.

| Method | Endpoint | Contract |
| --- | --- | --- |
| GET | `/api/sales/reconciliations/export-data` | Query `{gstin,year? ,fiscalYear?,format?}` returns `{exportData:{clientGstin,year,fiscalYear,periodLabel,format,rows[]}}`; rows contain `id`, return period, worksheet/column metadata, and numeric `value` |
| POST | `/api/sales/reconciliations/export` | Body `{gstin,year?,fiscalYear?,filename?,format?,rows?:[{id,value}]}` downloads the workbook with optional cell amendments; cell IDs must belong to the selected export scope and values must be numeric; amendments affect only the downloaded workbook |
| DELETE | `/api/sales/reconciliations/:id` | Deletes only the owner's saved reconciliation and returns `204`; absent or unowned IDs return `404 RECONCILIATION_NOT_FOUND`; uploaded documents remain intact |

Return periods accept `MMYYYY` and ordered `MMYYYY-MMYYYY` ranges. Filed range returns remain one `result.periods[]` entry; the monthly workbook format can project those ranges into month rows. Legacy single-period saved results and saved comparison snapshots remain exportable when their original documents cannot reload.

Competing writes that exceed SQLite's busy timeout return `409 DATABASE_WRITE_BUSY`. Database tables remain compatible with the existing schema. Backend tests use isolated temporary SQLite databases and actual uploaded files and templates.