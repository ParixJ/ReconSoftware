# Scrutiny comparison matrix

This document lists the amount comparisons the scrutiny engine performs across uploaded files. Every reportable comparison should include:

- `expectedAmount`: the external/supporting/control amount.
- `actualAmount`: the book/current amount.
- `differenceAmount`: `actualAmount - expectedAmount` unless the check explicitly states another sign convention.
- `sourceRefs`: provenance for the rows used.
- `expectedEntries` / `actualEntries` when transaction-level or reference-level matching is possible.

If a stable reference is unavailable, the engine must not invent an entry match from amount alone. It may produce an aggregate control row, or return `insufficient_data` when even aggregate comparison is unsafe.

## Cross-file amount comparisons

| Check | Expected side | Actual side | Match key | Parser requirements | Report detail |
|---|---|---|---|---|---|
| `B03` trial balance | Book-ledger closing balance | Trial-balance closing signed balance | Ledger name | Books ledger export and current trial balance with explicit closing controls | Ledger, expected, actual, difference, source refs |
| `B20` voucher-vs-ledger coverage | Voucher debit/credit totals | Ledger statement debit/credit totals | Ledger name | Books voucher export and books ledger export with unambiguous ledger names | Debit/credit differences by ledger |
| `P01` opening carry-forward | Prior-year trial-balance closing | Current trial-balance opening | Ledger name | Consecutive current/prior trial balances | Ledger, prior closing, current opening, difference |
| `P02` year-on-year movement | Prior-year trial-balance closing magnitude | Current trial-balance closing magnitude | Ledger name | Consecutive current/prior trial balances | Ledger, prior/current amount, amount/percent movement |
| `PY01` prior report | Structured prior-year report ledger closing/disclosure | Current trial-balance opening where applicable | Ledger name | `prior_year_report` support source plus current trial balance | Disclosure rows and opening differences |
| `AIS01` AIS income | AIS income record | Tagged book income record | Taxpayer + category + period + reference | AIS rows and book vouchers with income category/period/reference | Matched/unmatched/different income references |
| `AIS02` GST turnover | AIS GST turnover period | Book taxable/sales period | Month/period | AIS verified table or rows; mapped sales/taxable book rows | Period, expected, actual, difference, rounding flag |
| `A26` AIS vs Form 26AS | AIS TDS/TCS candidate | Form 26AS gross/section/TAN group | Section + TAN/party | AIS TDS/TCS tables or summaries; Form 26AS rows | Section, TAN/table, candidate vs 26AS, comparison state |
| `G02` GST cash ledger | Portal GST cash deposit/utilization | Mapped book GST cash movements | Tax head aggregate | GST cash ledger and mapped CGST/SGST book ledgers | Tax head, deposit/utilization differences |
| `G03` GST cash/credit | Portal GST cash/credit transaction or tax-head bucket | Mapped book GST cash/credit movement | Reference, or date/counterparty/amount context; otherwise tax-head aggregate | GST cash/credit support plus mapped IGST/CGST/SGST/cess book ledgers | Per-entry expected/actual entries where keyed; aggregate fallback otherwise |
| `S01` stock quantity | Product opening + receipts - issues | Printed product closing quantity | Product ledger controls | Product ledger workbook | Product quantity roll-forward difference |
| `BK01` bank statement | Bank statement deposit/withdrawal | Mapped bank ledger debit/credit | Reference, or date/counterparty/amount context; otherwise aggregate | `bank_statement` support plus mapped `bank` book role | Deposit/withdrawal entry rows or aggregate rows |
| `L01` loan schedule | Loan schedule closing balance | Mapped loan book closing balance | Lender/loan ledger name | `loan_schedule` support plus mapped loan ledgers | Closing balance tie-out and schedule roll-forward differences |
| `AT01` challans | Tax/GST-TDS challan amount | Mapped advance-tax/GST-TDS book posting | Challan/reference, or date/counterparty/amount context; otherwise aggregate | `tax_challan` support plus mapped `advance_tax` / `gst_tds_payable` book roles | Challan-vs-book entry rows or aggregate rows |
| `T03` tax credits | Form 26AS TDS/TCS tax credits | Mapped TDS/TCS book movements | TAN where available, otherwise type aggregate | Form 26AS plus mapped TDS/TCS book roles | Credit type, expected, actual, difference, source refs |
| `TDS01` TDS auditor | Expected TDS from classified expenses/rules | Booked TDS credits | Section/rule bucket | Classified expense postings plus mapped TDS payable/receivable | Section, gross, threshold, expected TDS, booked TDS, difference |
| `X01` general support | TIS/Form 26AS/GST/computation/AIS support measure | Mapped book measure | Exact reference + tax period when available; otherwise comparable aggregate | Comparable support sources and approved book account roles | Expected/actual entries for referenced matches; aggregate rows for safe totals |

## Parsing prerequisites

- Books must use approved account roles for cross-file checks: `sales`, `business_receipts`, `purchases`, `interest_income`, `bank`, `advance_tax`, `gst_tds_payable`, `tds_receivable`, `tcs_receivable`, `tds_payable`, `loan`, `secured_loan`, `unsecured_loan`, and GST cash/credit tax-head roles.
- Supporting CSV/JSON/XLS/XLSX files should declare a support `documentType` when not auto-detected.
- Structured support files should expose stable references where possible: invoice number, challan number, TAN, UTR, voucher ID, transaction ID, date, party/counterparty, and amount.
- Missing explicit controls remain missing. The engine must not infer opening/closing balances or transaction matches from amount alone.

## Report shape

Detailed comparison rows use this shape where possible:

```json
{
  "label": "Bank deposit",
  "comparison": "difference",
  "comparisonKey": "UTR123",
  "expectedAmount": "10000.00",
  "actualAmount": "8000.00",
  "differenceAmount": "-2000.00",
  "expectedEntries": [{ "side": "bank_statement", "amount": "10000.00", "reference": "UTR123" }],
  "actualEntries": [{ "side": "books", "amount": "8000.00", "reference": "UTR123" }],
  "sourceRefs": []
}
```

This is the required standard for new cross-file comparisons.
