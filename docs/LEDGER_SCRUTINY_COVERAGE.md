# Ledger scrutiny coverage

The reference `Ledger_Scrutiny_TDS_CRM_44.html` supplies field-header aliases and ledger presentation examples. `Scrutiny manual points.xlsx` includes both machine-checkable controls and procedures requiring source documents or professional judgment. These references are development inputs, not executable authority.

## Structured ledger extraction

- Flat CSV/XLS/XLSX ledger tables automatically locate a ledger/account plus amount header within the first 100 rows; approved mapping profiles remain the override for ambiguous layouts.
- Repeated ledger sections scan up to 100 rows after each `Ledger:`/`Account Statement For` marker for date, particulars, voucher type/number, debit and credit aliases. Section boundaries, entity heading, address lines, and source row coordinates are retained in `ledgerStatements`; individual postings are retained on normalized ledger records and in the persistent record collection.
- Explicit `Company:`/`Entity:` headings separate companies with the same ledger name. A source containing multiple entities is `insufficient_data`; the companies must be supplied as separate sources for scrutiny because entity-specific selection is not yet implemented. No cross-company totals are combined for scrutiny.
- Opening and closing balances are separate controls. In Tally-style ledger statements the printed closing amount sits on the balancing column, so its signed account balance is the inverse of that column. An absent control remains absent; it is not inferred from movements or a subtotal.

## Automated checks corresponding to the manual

| Manual topic | Current check | Boundary |
| --- | --- | --- |
| Opening/closing checked | `B02` ledger roll-forward | Requires all four explicit opening, debit, credit and closing values for a conclusive result. |
| Dormant balances | `B04` | Flags nonzero balances without movement; does not decide whether a balance is recoverable. |
| Negative cash balance | `B05` | Requires an auditor-mapped `cash` account, explicit opening and valid dates; compares day-end balances, not unknown intra-day transaction order. |
| Books voucher versus ledger coverage | `B20` | Requires unambiguous ledger names or a crosswalk and like-for-like entity/year. |
| Trial balance and prior-year comparison | `B03`, `P01` | Require separately supplied complete trial balances. |
| AIS, Form 26AS and GST supporting evidence | `AIS01`, `AIS02`, `A26`, `G01`, `G02`, `X01` | Only normalized, verified measures and approved account roles are compared. |

The manual's source-of-funds, relatives, confirmations, legal threshold, due-date and documentary-vouching procedures are not inferred from account names or amounts. They require reviewer decisions and/or additional evidence; those procedures are not implemented as automatic conclusions.

The Gayatri workbook yields 119 ledger sections and 2,762 postings. Only 38 sections print all four `B02` controls; 81 cannot be asserted as roll-forward matches. The Ashwin XLS yields 308 sections and 18,010 postings, with many omitted opening or closing controls. Both exports can still be scrutinized per eligible check. The source-level `Complete export` confirmation remains independent of whether every ledger prints opening and closing controls.

Reference-HTML parity is currently verified only for the suspense, pending-GST and prepaid-reversal candidates in a reproducible browser fixture (`SCRUTINY_REFERENCE_PARITY=1 node --test test/referenceHtmlParity.test.js`). New `B06`–`B11` and `P02` checks expose reference-style ledger observations with provenance, but never infer a missing balance or elevate a name-only clue to a definitive conclusion. The manual checklist is displayed in the report page. This is not full parity with the reference's MSME, TDS auditor, bank/loan, tax/advance-tax, prior-report extraction, or all YoY modules.

An upload marked `insufficient_data` solely for unconfirmed completeness can now run checks on its parsed rows. The findings remain `review` with source-limitations attached; missing check-specific controls may still produce `insufficient_data`. In particular, `B04` retains identified dormant-balance candidates even if other ledgers in the same source lack closing balances. Existing saved runs are immutable and must be rerun to reflect this behavior.
