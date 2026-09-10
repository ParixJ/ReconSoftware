# GST parser suite

This directory is a drop-in extension of the existing production parser. The
application-facing API remains unchanged:

```js
import { parseUploadedFile } from "./parsers/index.js";

const parsed = await parseUploadedFile(filePath, originalName, mimeType);
```

## Public contract

`parseUploadedFile(filePath, originalName, mimeType)` still:

- detects PDF, JSON, XLSX and CSV inputs;
- returns `{ fileType, documentType, gstin, returnPeriod, rows, summary,
  anomalies, ...metadata }`;
- throws the production `AppError` shape for unreadable or unsupported files;
- preserves the existing generic, GSTR-2/GSTR-2B and sales-register behavior.

PDFs identified as GSTR-1 or GSTR-3B are routed internally to independent
parsers:

- `gstr1.js` parses outward-supply sections, amendments and credit/debit-note
  summaries;
- `gstr3b.js` parses tables 3.1, 3.2, eligible ITC and payment of tax;
- `salesRegister.js` detects ledger headers, normalizes invoice rows, groups
  monthly books totals, splits B2B/B2C and preserves signed adjustments;
- `pdfParserUtils.js` contains only shared text, amount, period and normalized
  result helpers.

No new runtime dependency is introduced. The suite uses the same
`pdf-parse`, `read-excel-file`, `csv-parse` and application `AppError`
dependencies already required by `index.js`.

## Integration

Copy the complete `parsers/` directory into the application at the same path,
or copy `gstr1.js`, `gstr3b.js`, `salesRegister.js` and `pdfParserUtils.js` into
its existing `parsers/` directory together with the updated `index.js`.
Existing callers do not need to change their imports or arguments.

The PDF parser requires an extractable text layer. Image-only documents return
a `SCANNED_PDF` error anomaly instead of being represented as a successful
zero-value return; OCR can be performed before this suite when required.

## Tests

From an ESM-enabled project, run:

```powershell
node --test parsers\gstr1.test.js parsers\gstr3b.test.js
```
