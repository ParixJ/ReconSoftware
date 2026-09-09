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
| GET | `/api/documents` | Yes | → `{documents[]}` without parsed rows |
| POST | `/api/documents/upload` | Yes | multipart `files` (1–10) → `{documents[], errors[]}` |
| GET | `/api/documents/:id` | Yes | → `{document}` including normalized rows/source fields |
| GET | `/api/document-org/:id` | Yes | Re-extracts the owned source file → `{document}` with `original:{fields[],rows[],rowCount,extractionVersion}` and no normalized `parsed` payload |
| DELETE | `/api/documents` | Yes | `{documentIds:[1–100]}` → `{deletedIds[],errors[]}`; returns `207` when only part of the selection could be removed |
| DELETE | `/api/documents/:id` | Yes | Removes the owned document metadata and uploaded file → `204` |
| PUT | `/api/documents/:id/mapping` | Yes | `{documentType,gstin,returnPeriod,fieldMap}` → `{document}` |
| PUT | `/api/documents/:id/view-preference` | Yes | `{mode:"original"|"hidden"}` → `{document}` |
| POST | `/api/reconciliations` | Yes | `{documentIds,amountTolerance,dateToleranceDays}` → `{reconciliation}`; returns `422 CLIENT_GSTIN_REQUIRED` when no selected document identifies the client and `422 CLIENT_GSTIN_MISMATCH` when selected documents identify different clients |
| GET | `/api/reconciliations` | Yes | → `{reconciliations[]}` |
| GET | `/api/reconciliations/export?gstin=:gstin&year=:year` | Yes | Downloads the latest monthly reconciliations for the client/year as the two-sheet `GST_Reconciliation_*.xlsx` template |
| GET | `/api/reconciliations/:id` | Yes | → `{reconciliation}` |

Supported `documentType` values are `gstr1`, `gstr2`, `gstr2b`, `gstr3b`, `salesRegister`, and `unknown`. `fieldMap` keys are restricted to the server's canonical columns.

The Home document viewer uses `GET /api/document-org/:id`, not normalized reconciliation rows. `original.fields` comes from the owner-scoped `document_org` metadata row and is reconciled with newly discovered source fields during extraction. Existing documents without metadata are backfilled on their first original-view request.

`POST /api/reconciliations` requires at least one GSTR-1 and one GSTR-3B. Before saving, the server cross-examines every detected client GSTIN in the authoritative selection. If none of the selected documents identifies a client GSTIN, the request is rejected without saving. Different known GSTINs also reject the whole request. Partial missing GSTINs remain resolvable mapping exceptions, but comparisons involving those unverified documents are withheld. Successful results include `result.crossExamination` with `{status,canReconcile,clientGstin,documentCount,identifiedCount,gstinGroups[],missingDocuments[]}`. Returns are grouped by `returnPeriod`; values are not aggregated across months. Each `result.periods[]` entry contains `{returnPeriod,clientGstin,status,documents[],summary,comparisons[],exceptions[],suggestions[]}`. Selected `salesRegister` documents add books-to-GSTR-1 and books-to-GSTR-3B checks for each matching monthly bucket; selected GSTR-2/GSTR-2B documents add ITC checks for their matching month.

Reconciliation exceptions include `{id,code,rootField,severity,message,suggestion,documentId?,rowIndex?}`. `GET /api/reconciliations` and `GET /api/reconciliations/:id` return active exceptions evaluated against the documents' current mappings; resolved exceptions are omitted.
