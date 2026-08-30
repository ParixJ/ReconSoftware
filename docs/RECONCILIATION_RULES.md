# Reconciliation rules

This release performs deterministic review checks; it does not file or modify a GST return.

## Sales register to GSTR-1

When a sales register is selected, its net taxable-outward control totals are compared with GSTR-1 for taxable value and each tax head. The register parser groups dated ledger rows by `MMYYYY`, separates B2B/B2C controls, and treats recognized credit entries as signed adjustments. For a multi-period workbook, only the bucket matching the single selected GSTR-1/GSTR-3B period is used. A selected register without that period is reported as a blocking data exception rather than compared as zero.

The books check is a control-total comparison. It does not claim invoice-level matching where a PDF return provides only section summaries.

## GSTR-1 to GSTR-3B liability

The engine compares these official table relationships:

| GSTR-3B | GSTR-1 source | Measures |
| --- | --- | --- |
| 3.1(a) taxable outward | 4, 5, 6C, 7, 9, 10, 11 | taxable value and tax heads |
| 3.1(b) zero-rated outward | 6A, 6B, 9 | taxable value and tax heads |
| 3.1(c) nil/exempt outward | 8 | value |
| 3.1(e) non-GST outward | 8 | value |
| 3.2 inter-state supplies to unregistered persons | PoS-wise B2CL/B2CS | taxable value and IGST |

When GSTR-2B is selected, reverse-charge supplies are also compared with GSTR-3B table 3.1(d) by taxable value and tax head.

Credit/debit note amounts are treated as signed adjustments when the source indicates a credit note. Differences at or below the configured rupee tolerance are marked matched. A larger GSTR-1 liability than GSTR-3B is a high-priority under-reporting exception; the reverse is an excess/omission review exception.

## GSTR-2B to GSTR-3B ITC

When both are selected, available ITC tax heads in GSTR-2B are compared with claimed ITC in GSTR-3B table 4. Claim above available ITC is high priority. Reverse-charge records are identified separately in the normalized document view.

## Integrity checks

- Client GSTIN and return period agree across selected documents.
- GSTIN shape is valid for client and counterparty identifiers.
- Required identity/type/period fields exist.
- Invoice keys are not duplicated inside a return.
- Invoice dates are within the return period plus the configured date tolerance.
- Taxable value and tax amounts are numeric and invoice totals are not below their components.

The engine provides a suggested review action for every exception. It does not infer a legal conclusion or alter source records.
