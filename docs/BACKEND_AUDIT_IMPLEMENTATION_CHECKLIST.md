# Backend audit and comparison implementation checklist

Status: implementation plan, not an approved audit program or legal rulebook.

Scope: JavaScript/Express backend serving a React audit workspace; TypeScript is not required. The current books are the anchor dataset; Tally multi-ledger JSON may be one input, but voucher and master exports are needed where a report omits counter-postings, bill allocations, party identity, or tax entries. This checklist inventories comparison and review areas in `Ledger_Scrutiny_TDS_CRM_44.html` and `../Scrutiny manual points.xlsx`. The workbook's two populated sheets are identical; do not import the same procedures twice. The HTML contains a condensed manual checklist and heuristic rules. Neither is authority for statutory conclusions.

Checkbox legend: `[ ]` not implemented; `[x]` implemented and verified; `[?]` awaiting domain decision. Keep checkboxes unchecked until the actual backend and its tests exist.

## 0. Decisions and audit ownership before implementing legal conclusions

- [ ] Name the supported accounting systems, export types, financial years/tax years, entity types, and audit engagements.
- [ ] Obtain anonymized real samples for each source and an auditor-approved expected result for each comparison family.
- [ ] Appoint a qualified rule owner to approve applicability, statutory references, effective dates, rates, thresholds, exclusions, severity, and expected findings.
- [ ] Decide the authoritative source and comparison grain for every check below: voucher/posting, bill, bank transaction, party-month, party-year, contract, ledger-period, item-period, or closing balance.
- [ ] Record whether each item is an **integrity control**, **numeric reconciliation**, **risk indicator**, **manual procedure**, or **confirmed exception requiring reviewer approval**.
- [ ] Mark prototype/manual statements such as cash limits, the unsecured-loan 12–15% interest band, balance-sheet presentation, and TDS applicability as `DOMAIN_REVIEW_REQUIRED`; do not silently encode them as law.
- [ ] Version tax rules by the date that determines their applicability, not merely by upload date. The Income Tax Department describes a transition for TDS events on/after 1 April 2026; retain both the governing provision and the displayed/filing reference in rule outputs. [Official TDS transition FAQ](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/tds-compliance)

## 1. Source intake and canonical data

- [ ] Require authenticated, organization-scoped `engagementId`, entity identity, period, document role, currency, file hash, upload user, and upload time for every source.
- [ ] Preserve the immutable original file/export and source metadata; never overwrite it after mapping corrections.
- [ ] Validate source company identifiers, fiscal period, completeness, duplicate uploads, unsupported versions, and file safety before ingestion.
- [ ] Capture source-specific JSON/Excel/PDF fixtures; do not assume all Tally JSON exports have the same fields. TallyPrime 7.0 documentation describes JSON exchange for masters, transactions, vouchers, and reports. [Tally export documentation](https://help.tallysolutions.com/export-data-in-tally/)
- [ ] Normalize **vouchers** separately from **postings**. Keep voucher ID/number/type/date/status, each ledger posting, debit or credit side, party, bill/invoice reference, cost centre, inventory allocations when available, and narration.
- [ ] Normalize **ledger masters** separately: stable source identifier, name, parent group, account role, opening/closing balance and source sign convention.
- [ ] Normalize external records into source-specific JavaScript objects/collections (bank, GST, TDS, AIS/26AS, loan, supplier bill/payment, investment/Demat, stock, policy, prior-year statement); never coerce every document into generic ledger rows.
- [ ] Define plain-JavaScript object shapes for each normalized record and validate them at parser output, persistence input, and rule-run boundaries. Reject or quarantine malformed records; do not rely on property names being present by convention.
- [ ] Retain provenance for every normalized field: source document hash, source object/row ID, sheet/cell or page/box, raw value, parser/mapping version, confidence, and reviewer correction history.
- [ ] Use exact decimal representation (MongoDB Decimal128 or integer paise with range checks); retain currency and original precision. Do not use JS floating-point arithmetic for audit amounts.
- [ ] Define one internal posting sign convention, retain original Dr/Cr presentation, and separate opening/closing/subtotal/detail rows from actual economic postings.
- [ ] Group split postings under the same voucher; avoid counting a voucher total and its detailed lines as independent transactions.
- [ ] Store an immutable accepted `datasetVersion`; subsequent parsing or mapping corrections create a new version and invalidate dependent comparison/rule runs.

## 2. Data-quality gates before any scrutiny

- [ ] Verify all pages/sheets/records were processed and report parsed, rejected, and review-required counts; a nonempty parse is not proof of completeness.
- [ ] Check required identifiers, dates, valid amounts, duplicate source IDs, posting signs, currency consistency, and financial-period boundaries.
- [ ] Check each full voucher's debit total equals credit total, subject to a documented rounding tolerance; distinguish incomplete export from unbalanced books.
- [ ] Reconcile ledger opening + signed movements to reported closing; retain source and computed figures and the exact difference.
- [ ] Reconcile aggregate ledger balances to trial balance/control totals when a TB is supplied.
- [ ] Record missing or low-confidence fields as data-quality issues; block only comparisons dependent on those fields, not unrelated checks.
- [ ] Require an auditor-visible acceptance/rejection event for corrected or uncertain source data before final run/sign-off.

## 3. One reusable comparison engine

- [ ] Every comparison definition declares: `id`, purpose, required sources/fields, entity and period scope, grain, normalization, candidate keys, cardinality, tolerance, applicable rule version, and result classification.
- [ ] Match in ranked passes: authoritative ID/reference -> verified composite key -> amount/date/party candidate -> reviewer-assisted match. Never let a weak amount-only match silently outrank a strong identity mismatch.
- [ ] Support one-to-one, one-to-many, many-to-one, partial allocation, reversals, and split settlements where the business process permits them.
- [ ] Enforce non-overlapping consumption of matched records within a run; prevent the same external row from clearing multiple book items unless an explicit allocation records that relationship.
- [ ] Persist candidate matches and scores; represent multiple plausible candidates as `AMBIGUOUS`, not arbitrarily `MATCHED`.
- [ ] Store both directions: `BOOKS_ONLY` and `EXTERNAL_ONLY`; never omit unused records merely to reduce noise.
- [ ] Compare only equivalent measures: gross vs gross, taxable vs taxable, tax-head vs same tax-head, principal vs principal, and balance vs balance. Store the measure/basis in the result.
- [ ] Store `signedDifference = booksComparable - externalComparable`, `absoluteDifference = abs(signedDifference)`, tolerance, currency, and source values as decimal strings.
- [ ] For trends additionally store `signedChange = current - prior`, `magnitudeChange = abs(current) - abs(prior)`, percentage denominator and a separate `SIDE_REVERSAL` flag. Equal absolute balances with opposite accounting sides must not silently pass.
- [ ] Apply absolute and relative tolerances only where specified; log why a tolerance was accepted. Round solely for display after the calculation.
- [ ] Persist one result status from `MATCHED`, `MATCHED_WITH_TOLERANCE`, `VALUE_MISMATCH`, `SIDE_MISMATCH`, `PERIOD_MISMATCH`, `BOOKS_ONLY`, `EXTERNAL_ONLY`, `PARTIAL`, `AMBIGUOUS`, `INSUFFICIENT_DATA`, `NOT_APPLICABLE`, or `ERROR`.
- [ ] Separate **comparison result** from **finding**. A mismatch can be timing, classification, source error, or genuine exception; only the reviewed finding states the conclusion.
- [ ] Link both sides of every match and discrepancy to original source records and calculations; retain a deterministic explanation trace.
- [ ] Make a comparison run idempotent for the same dataset versions, rule versions, parameters and matching algorithm version; support safe retries and cancellation.

### Minimal JavaScript result shape

```js
const comparisonResult = {
  comparisonId: "bank-transaction-v1",
  runId: "run-123",
  datasetVersions: ["books-v2", "bank-v1"],
  ruleVersion: "1.0.0",
  grain: "BANK_TRANSACTION",
  key: { bankAccountId: "account-456" },
  booksRecordIds: ["posting-1"],
  externalRecordIds: ["statement-line-9"],
  measure: "INR_TRANSACTION_AMOUNT",
  booksAmount: "10000.00",
  externalAmount: "9998.00",
  signedDifference: "2.00",
  absoluteDifference: "2.00",
  tolerance: "5.00",
  status: "MATCHED_WITH_TOLERANCE",
  matchMethod: "REFERENCE_DATE_AMOUNT",
  evidenceIds: ["evidence-1", "evidence-2"],
  explanation: ["Reference and direction agree; amount differs by INR 2.00."],
};
```

- [ ] Implement `validateComparisonResult(value)` (and corresponding validators for source, voucher, posting, ledger, and finding objects) in JavaScript. Validate required keys, nullability, enum values, ID arrays, ISO dates where applicable, decimal-string amounts, and the numerical invariant `absoluteDifference = abs(signedDifference)` using decimal arithmetic when both are present.
- [ ] Return structured validation errors at API and worker boundaries; never silently fill missing audit fields with zero, an empty string, or a fabricated match.
- [ ] Keep example objects and validation tests as the executable contract shared between Express services and React API consumers. Use an existing runtime schema library if the backend already has one; no TypeScript conversion is needed.

## 4. Comparison inventory: base books and internal controls

Each item below needs an approved applicability definition, fixture, result schema, and unit/integration tests. A `REVIEW` label means that even a positive test is not a confirmed error.

- [ ] **B01 Voucher balance:** sum debit postings vs sum credit postings, by complete voucher; distinguish excluded/cancelled/optional vouchers and export incompleteness.
- [ ] **B02 Ledger roll-forward:** opening + debit movement - credit movement vs closing, by ledger and period; verify sign convention and reversals.
- [ ] **B03 Trial balance control:** grouped ledger closings and debits/credits vs supplied TB and financial-statement control totals.
- [ ] **B04 Dormant/unchanged balance:** opening vs closing with no genuine movement, by ledger; report age and history, not automatic misstatement.
- [ ] **B05 Suspense/unclassified balance:** closing vs approved materiality/age policy; require ledger-role mapping rather than a name-only regex.
- [ ] **B06 Debtor/creditor side:** expected asset/liability side vs closing side; permit genuine advances, overpayments, refunds and reclassifications.
- [ ] **B07 Physical cash:** running and closing cash balance vs zero; keep GST electronic cash ledgers separate from physical cash.
- [ ] **B08 High cash:** daily/month-end cash levels vs auditor-configured risk band; if cash-credit/overdraft account exists, create a review question, not a tax conclusion.
- [ ] **B09 Cash payments:** payments by counterparty/day/transaction as required by the approved rule vs applicable threshold; consider cash-book counter-posting, transport category, reversals and documented exceptions.
- [ ] **B10 Cash receipts:** physical cash receipts by correct statutory/review grain vs approved rule; do not conflate bank receipts or electronic cash ledgers.
- [ ] **B11 Duplicate vouchers:** candidate same entity/ledger/date/amount/side with distinct voucher identities; suppress multiple lines of one voucher and GST component rows; allow legitimate recurring entries.
- [ ] **B12 Expense spikes:** monthly ledger amount vs baseline and absolute materiality; handle missing months, seasonal businesses, reversals and zero/negative baseline.
- [ ] **B13 Possible capital/revenue misclassification:** ledger class vs narration/counter-account/item-master clues; produce review candidate with linked voucher and invoice.
- [ ] **B14 Scrap transactions:** classify scrap sales/purchases by transaction side and nature; compare to sales/purchase, stock and applicable tax sources only when present.
- [ ] **B15 Provision movement:** prior closing/current opening, reversals, current additions, settlements and current closing by provision type; flag unexplained unchanged balances.
- [ ] **B16 Prepaid movement:** opening + additions - amortization/reversals vs closing by policy/contract; ledger-name-only insurance check remains a review prompt.
- [ ] **B17 GST/RCM internal movement:** input vs output/liability by tax head and period; never assert RCM 'nullification' or ITC eligibility from equal ledger totals alone.
- [ ] **B18 TDS candidate spending:** contractor, rent, professional, technical, interest, purchase, partner and other candidate heads; this is classification for the TDS workflow, not proof of liability.
- [ ] **B19 Manual-only disabled signals:** do not revive the prototype's disabled round-amount or missing-narration rules without explicit approval and a false-positive study.

## 5. Comparison inventory: previous year, statements, and external evidence

Format: **ID — comparison (grain); required reference; condition/evidence**.

### Prior year and financial statements

- [ ] **P01 — PY closing vs CY opening** (mapped ledger); accepted prior-year closing/TB; distinguish actual mismatch from display sign convention, mapping change, restatement and opening journal.
- [ ] **P02 — CY vs PY balances/movements** (ledger/group); accepted prior-year dataset; retain signed change, magnitude change, percent, new/discontinued heads and explanation threshold.
- [ ] **P03 — fixed-asset schedule roll-forward** (asset class/item); schedule and GL; opening + additions - disposals - depreciation/adjustments vs closing, then PY closing WDV vs CY opening WDV.
- [ ] **P04 — depreciation expense** (class/period); schedule vs GL vs PY; separate accounting and tax calculations if both exist.
- [ ] **P05 — financial-statement activity/comparatives** (revenue/expense/group); prior-year statements and current books; flag unusual new/discontinued lines for auditor explanation.
- [ ] **P06 — prior-year audit query/disallowance follow-up** (query/item); prior audit report, query log, tax computation and CY settlement; manual reviewer closes with evidence.

### Bank, cash, and confirmations

- [ ] **F01 — bank transaction reconciliation** (account/transaction); bank statement vs bank GL, using amount, direction, date and reference; support cheques in transit, charges, interest, reversals, transfers and partial settlement.
- [ ] **F02 — bank opening/closing and BRS** (account/date); statement balance vs book balance plus identified reconciling items; calculate a complete bridge, not just matched-transaction count.
- [ ] **F03 — missing bank charges/interest** (account/statement item); bank-only items to proposed accounting entry; reviewer confirms posting and rerun.
- [ ] **F04 — opened/closed bank accounts** (account/year); bank confirmation/master vs book account list; missing or stale accounts become review tasks.
- [ ] **F05 — bank/loan confirmation by correspondence** (account/period); confirmation vs books; retain sent/received/exception status, not just a checkbox.

### Borrowings, deposits, parties, and advances

- [ ] **L01 — secured-loan roll-forward** (facility/period); opening + drawdowns - principal repayments +/- adjustments vs GL and lender statement; separate principal, interest and charges.
- [ ] **L02 — interest and charges** (facility/period); lender statement/sanction terms vs GL; handle accrued vs paid amounts and loan subsidy separately.
- [ ] **L03 — loan identity and purpose** (facility); sanction/confirmation/asset evidence vs entity, utilization and capitalization; reviewer decision where documents are interpretive.
- [ ] **L04 — unsecured-loan acceptance/repayment** (lender/transaction/year); loan GL vs bank/cash, PAN/source declaration and confirmation; statutory reporting is effective-dated and auditor-approved.
- [ ] **L05 — related-party loan/interest** (party/year); verified related-party register vs book counterparties and interest postings; do not infer relation solely from name.
- [ ] **L06 — creditor/debtor/advance balance confirmation** (party/date); contra statement/confirmation vs book closing plus invoice/payment differences.
- [ ] **L07 — party-account mixture** (party/voucher); supplier/customer activity vs loan/advance activity within one ledger; raise classification-review task rather than auto-reclassify.
- [ ] **L08 — advance from customers clearance** (receipt/bill); opening/receipt vs sale application, refund or journal; flag unexplained or cash settlement for rule review.
- [ ] **L09 — advance to suppliers clearance** (advance/bill); advance vs purchase invoice, adjustment or refund; recognize partial application and aged balance.
- [ ] **L10 — creditor/debtor journals and bad debts** (party/voucher); journals, discounts, write-offs, ageing and support; legal action and recoverability require reviewer evidence.
- [ ] **L11 — deposits received/made** (party/contract); original amount + additions - repayments vs closing, nature/ownership/terms, cash movement and reporting classification.
- [ ] **L12 — deposit interest** (party/period); contract/interest statement vs book accrued/received income and tax credit in 26AS; separate principal from interest.
- [ ] **L13 — long-outstanding deposits and cross-ledger ties** (party/period); deposit vs associated loan, telephone/service expense, Demat account or closure; review unresolved residuals.
- [ ] **L14 — sister-concern contra accounts** (entity-pair/period); both entities' ledgers when both are in scope, including date/side differences; prevent disclosure of one client's data to unauthorized users.
- [ ] **L15 — capital introductions/drawings** (owner/transaction/month); capital GL vs bank/source evidence; large or unusual items and withdrawal adequacy remain reviewer judgments.

### Tax, GST, MSME, and supporting records

- [ ] **T01 — TDS obligation vs deduction** (payee/provision/trigger event); expense/payment/advance postings vs TDS postings; determine payer/payee status, nature, threshold grain, taxable base, exemption/certificate and credit/payment timing first.
- [ ] **T02 — TDS deduction vs deposit/return** (deductor/provision/period); book TDS liability vs challan/return/statement; reconcile dates, amount, correction returns and carry-forward.
- [ ] **T03 — TDS receivable/income** (deductor/period); income or receivable GL vs 26AS/AIS and tax computation, with refund/interest separated from turnover-information entries.
- [ ] **T04 — GST book vs portal ledgers/returns** (GSTIN/period/tax head/transaction type); match like-for-like CGST/SGST/IGST/cess and input/output/cash movements; retain portal-only, books-only, timing and wrong-head cases.
- [ ] **T05 — RCM** (supplier/period/tax head); underlying eligible supply, liability, payment and potential ITC; no net-zero conclusion from input/output totals without eligibility and timing evidence.
- [ ] **T06 — MSME payment ageing** (eligible supplier/bill/payment allocation); verified supplier status, acceptance date, agreed due date, payments and year-end outstanding; allocate partial payments and send unclear identity/dates to review.
- [ ] **T07 — insurance/prepaid allocation** (policy/coverage period); premium invoice and coverage schedule vs expense/prepaid GL, current-period expense and next-period reversal.
- [ ] **T08 — statutory-dues/provisions payment** (due type/period); provision vs subsequent payment evidence and prior-year disallowance; statutory consequence requires approved rule version.
- [ ] **T09 — tax computation/refund** (assessment year/event); computation vs AIS/26AS, bank and book refund/interest; do not compare a PY computation refund to unrelated CY operating income.
- [ ] **T10 — jobwork/contractor classification** (party/voucher); purchase vs service/jobwork evidence and related TDS workflow; reviewer validates transaction nature.

### Inventory, investment, and other evidence

- [ ] **S01 — stock quantity roll-forward** (item/location/period); opening + receipts - issues +/- adjustments vs closing; flag negative running quantity and missing movements.
- [ ] **S02 — slow/non-moving stock** (item/as-of date); last relevant movement/sale vs audit date and approved bands; distinguish no movement from no data.
- [ ] **S03 — stock value/tax attributes** (item/period); inventory report vs GL/valuation basis, HSN/GST and ITC metadata; tax eligibility and valuation method need review.
- [ ] **I01 — investment holdings** (security/account/date); investment GL quantity/cost vs Demat or certificate; include acquisitions, sales, corporate actions and balances.
- [ ] **I02 — investment income** (instrument/period); interest/dividend schedule vs GL, AIS/26AS and receivable; isolate TDS from gross income.
- [ ] **I03 — investment disposal** (lot/transaction); proceeds - supported carrying cost/fees vs recorded gain/loss; check statement and proof for off-market or exceptional sales.
- [ ] **I04 — investment classification and valuation disclosure** (instrument/year); quoted/unquoted, ownership, accounting policy and disclosure evidence; reviewer approves conclusions.
- [ ] **I05 — share application money/deposit maturity** (instrument/event); allotment/refund or maturity proceeds vs GL and evidence; review residual receivables.

## 6. Manual-audit procedures that must not be auto-closed by arithmetic

- [ ] Convert each unique item in `../Scrutiny manual points.xlsx` to a stable `procedureId`, group, trigger, required evidence, assignee, status and reviewer note. Preserve workbook row number for traceability.
- [ ] Preserve procedures for vouching coverage, prior-year queries, audit report/yellow-sheet reference, error log, client query communication, and proof/confirmation requests.
- [ ] Preserve asset/liability classification and presentation checks (reserves, subsidy, advances, deposits, investments, mixed accounts) as review tasks pending approved accounting policy.
- [ ] Preserve judgments about reasonableness, ownership, source of funds, related-party identity, collectability, market price, capital-asset use date and legal action as human determinations.
- [ ] A procedure can be `NOT_STARTED`, `IN_PROGRESS`, `EVIDENCE_REQUESTED`, `EVIDENCE_RECEIVED`, `RESOLVED`, `NOT_APPLICABLE`, or `BLOCKED`; store actor/time/evidence for every transition.
- [ ] Do not mark a procedure complete merely because a file was uploaded or a keyword was found in extracted text.
- [ ] Require approved rationale and a reviewer identity for `RESOLVED` or `NOT_APPLICABLE` on material procedures.

## 7. Express backend, persistence, and access control

- [ ] Keep source intake/parsers, dataset normalization, comparison engine, statutory rule packs, findings/review, and exports as separate service modules behind explicit contracts.
- [ ] Define organization/engagement authorization for every route, job, object-store key and MongoDB query; never accept tenant or engagement scope from an unverified client field alone.
- [ ] Prefer asynchronous jobs for large imports, OCR, matching and rule runs; expose job state and bounded error details to React. Use retries only for retryable failures and idempotent work.
- [ ] Persist original sources outside MongoDB documents; store secure references, hashes, retention policy and access logs.
- [ ] Use collections or equivalent for `engagements`, `sourceDocuments`, `datasetVersions`, `vouchers`, `postings`, `ledgers`, `externalRecords`, `mappingProfiles`, `comparisonDefinitions`, `comparisonRuns`, `comparisonResults`, `ruleVersions`, `findings`, `procedures`, and `auditEvents`.
- [ ] Index tenant + engagement + version + key fields used in candidate matching; benchmark full-year large-client volumes.
- [ ] Keep comparison-result snapshots and reviewer decisions immutable or append-only; changes create new events/versions.
- [ ] Return paginated, filterable comparison results with drill-down evidence; the React UI should not be the authoritative calculation or decision store.
- [ ] Provide API contracts for: source upload/list/preview; mapping review/accept; dataset validation/accept; run creation/status/cancel; results/summary; candidate match approval; finding disposition; procedure evidence/sign-off; export.
- [ ] Do not expose OCR snippets, PAN/GSTIN, bank details, or raw source text through broad logs or unscoped error responses.

## 8. Test and release checklist for each comparison ID

- [ ] Add a domain-approved rule specification: purpose, accounting assertion, required sources, exact grain, formula, signs, applicability, exceptions, effective dates, materiality, and result examples.
- [ ] Add at least: exact match, within tolerance, beyond tolerance, wrong side, wrong period, books-only, external-only, duplicate, partial/multi-line, ambiguous candidate, reversal and missing-input fixtures.
- [ ] Test debit/credit sign flips and equal-magnitude opposite-side balances explicitly.
- [ ] Test that no posting/source row is silently consumed twice; test all matched + unmatched totals reconcile to source controls.
- [ ] Test large integer/decimal precision, Indian-number formatting, zero, null, negative, rounding and cross-currency cases.
- [ ] Test year-end and rule-effective-date boundaries, especially transitions across 31 March/1 April.
- [ ] Test parser-version change, corrected mapping, re-upload and rerun preserve old snapshots while generating new results.
- [ ] Test tenant isolation and authorization on every result/evidence route and background job.
- [ ] Test reviewer decisions and exported workpapers reproduce saved run values, status, evidence and rule version exactly.
- [ ] Run a shadow audit on multiple real anonymized engagements; measure false positives, missed differences, manual-review rate, import completeness and time-to-result before enabling automated conclusions.

## 9. Definition of done

A comparison ID is implemented only when it has a signed-off specification, validated canonical inputs, deterministic matching and difference calculations, both unmatched directions, source-to-result evidence, a stable persisted result, reviewer workflow, boundary tests, and an end-to-end run on a representative fixture. Passing a happy-path unit test is not enough. Statutory/compliance conclusions remain blocked until the domain owner approves the versioned rule and its effective period.
