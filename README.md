# ReconSoft

ReconSoft is a focused auditor workspace for ingesting GST returns and sales registers, reviewing all extracted source fields, correcting reconciliation mappings, and reconciling books with GSTR-1 and GSTR-3B (plus GSTR-2B ITC checks when selected).

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

The document viewer always renders every field extracted from the original upload. Reconciliation mappings remain a separate fixed schema and use only the columns needed by backend comparisons.

See `docs/ARCHITECTURE.md`, `docs/API_CONTRACTS.md`, `docs/DATABASE_SCHEMA.md`, and `docs/RECONCILIATION_RULES.md` for implementation contracts.
