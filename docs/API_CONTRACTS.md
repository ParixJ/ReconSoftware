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
| DELETE | `/api/documents/:id` | Yes | Removes the owned document metadata and uploaded file → `204` |
| PUT | `/api/documents/:id/mapping` | Yes | `{documentType,gstin,returnPeriod,fieldMap}` → `{document}` |
| PUT | `/api/documents/:id/view-preference` | Yes | `{mode:"original"|"hidden"}` → `{document}` |
| POST | `/api/reconciliations` | Yes | `{documentIds,amountTolerance,dateToleranceDays}` → `{reconciliation}` |
| GET | `/api/reconciliations` | Yes | → `{reconciliations[]}` |
| GET | `/api/reconciliations/:id` | Yes | → `{reconciliation}` |

Supported `documentType` values are `gstr1`, `gstr2`, `gstr2b`, `gstr3b`, `salesRegister`, and `unknown`. `fieldMap` keys are restricted to the server's canonical columns.

`POST /api/reconciliations` requires at least one GSTR-1 and one GSTR-3B. Selected `salesRegister` documents add books-to-GSTR-1 checks for the common return period; selected GSTR-2/GSTR-2B documents add ITC checks. Each comparison identifies its `sourceLabel` and `filedLabel` because the report can contain both books-to-GSTR-1 and return-to-GSTR-3B comparisons.
