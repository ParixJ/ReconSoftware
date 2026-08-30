# GST Reconciliation

A focused auditor workspace for ingesting GST returns and sales registers, reviewing normalized document data, correcting field mappings, and reconciling books with GSTR-1 and GSTR-3B (plus GSTR-2B ITC checks when selected).

## Run locally

Requires Node.js 22.5 or newer (the server uses the built-in SQLite module).

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://127.0.0.1:5173`. Create a local account on the sign-in screen. Uploaded documents and user sessions are stored in the server's SQLite database; original files remain in `server/data/uploads`.

## Quality checks

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

The browser test creates its own auditor account and uploads the fixtures in `sample-docs`.

## Supported input

- GST portal JSON (including GSTR-1, GSTR-2B and GSTR-3B structures)
- `.xlsx` GST workbooks and sales registers
- `.csv` tables
- text-based GSTR-1 and GSTR-3B PDFs, extracted with dedicated return parsers

Sales-register workbooks may contain heading rows before the ledger header. Dated rows are grouped by return period, and credit notes/credit entries are retained as signed adjustments. Image-only PDFs require OCR before upload.

If extracted columns do not satisfy the fixed reconciliation schema, the document viewer asks whether to render them exactly as extracted or keep the table hidden. The choice is stored with the document and can be changed later.

See `docs/ARCHITECTURE.md`, `docs/API_CONTRACTS.md`, `docs/DATABASE_SCHEMA.md`, and `docs/RECONCILIATION_RULES.md` for implementation contracts.
