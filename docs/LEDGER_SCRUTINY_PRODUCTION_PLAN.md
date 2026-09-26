# Ledger Scrutiny production parity plan

This app treats `sample-docs/Ledger_Scrutiny_TDS_CRM_44.html` as a parity target, not as source code to copy. The production path is server-owned scrutiny with persisted source evidence, immutable run results, reviewer decisions, and exportable workpapers.

## Current implementation baseline

- Keep the existing client/server architecture.
- Keep scrutiny sources parsed and stored through `scrutiny_sources`, `scrutiny_source_records`, and immutable `scrutiny_runs`.
- Keep source evidence provenance on every generated finding.
- Do not infer missing opening/closing controls as zero.
- Do not report legal/accounting conclusions from name-only classification; emit reviewer evidence.

## Implemented parity expansion

The following gaps from the reference HTML now have first-class check IDs or source contracts:

| Reference area | Production check/source | Notes |
|---|---|---|
| Previous-year report | `PY01`, `prior_year_report` | Carries forward disclosures and compares prior reported closings to current openings where structured rows are available. |
| MSME payments | `M01`, `msme_register` | Flags delayed or overdue MSME invoices from due/payment/outstanding evidence. |
| GST cash/credit matching | `G03` | Compares mapped book GST cash/credit ledgers to portal cash/credit ledgers across IGST/CGST/SGST/cess buckets. |
| Stock scrutiny | `S02`, `stock_report` | Flags negative and slow/non-moving stock candidates. |
| Bank scrutiny | `BK01`, `bank_statement` | Ties bank deposits/withdrawals to mapped bank book postings by reference/date context where available, with aggregate fallback. |
| Loan scrutiny | `L01`, `loan_schedule` | Validates schedule roll-forward and mapped book closing balances where available. |
| Advance-tax/challan review | `AT01`, `tax_challan` | Compares challan entries/totals to mapped advance-tax/GST-TDS book postings. |
| TDS Auditor | `TDS01` | Applies built-in TDS applicability screens to classified expense postings and mapped TDS credits. |
| Master export | Module sheets | XLSX exports now add module-specific sheets for MSME, GST, stock, bank, loans, tax/AIS/challans, YoY, TDS, book controls, and cross-source support. |
| Cross-file comparison report | Comparison matrix and detailed evidence rows | `docs/SCRUTINY_COMPARISON_MATRIX.md` lists each comparison. Keyed comparisons include `expectedEntries`, `actualEntries`, exact amounts and differences. |

## Remaining production-hardening work

1. Add dedicated parsers for native bank PDFs, lender loan schedules, MSME registers, and prior-year audit reports instead of relying only on structured CSV/JSON/XLSX.
2. Extend native document-specific parsers so more bank, GST, challan and loan files expose stable references for line-level matching.
3. Add editable reviewer allocation screens for timing differences and legal exceptions.
4. Add accountant-approved fixture packs for each module and opt-in real-sample parity tests.
5. Add configurable TDS rules with effective dates, vendor PAN/status, lower deduction certificates, and entity-type rates.
6. Add full manual-checklist persistence and attach checklist decisions to exports.
7. Add dashboard progress/status cards matching the reference HTML navigation.

## Acceptance gates for “complete production”

- Each module must have representative parser fixtures and scrutiny fixtures.
- Each finding must include source provenance and reviewer-safe wording.
- Exported workbooks must be generated server-side from saved runs.
- Incomplete sources must return `insufficient_data` or provisional `review`, never a false match.
- Real sample parity tests must pass when `SCRUTINY_REFERENCE_PARITY=1`.
