# GST Sales Reconciliation Tool

*UI and Interaction Design Specification*

| Document field | Value |
| --- | --- |
| Status | Design definition, ready for product and engineering review |
| Version | 1.0 |
| Last updated | 18 August 2026 |
| Scope | UI/UX design only; no application code, API contract, data model, or infrastructure design |
| Primary platform | Responsive web application |
| Intended users | Finance executives, accountants, tax reviewers, and finance administrators |
| Primary use case | Reconcile an organisation's sales register against filed or prepared GSTR-1 data |
| Visual direction | Minimal, calm, precise, flat surfaces, no gradients |
| Supported appearance | Light mode, dark mode, and system preference |

---

## 1. Purpose

This document defines the end-to-end product experience for a GST sales reconciliation Software. It covers information architecture, navigation, workflows, screen layouts, component behaviour, content, help patterns, visual tokens, responsive behaviour, accessibility, and design acceptance criteria.

The product should help a user answer four questions quickly:

1. Which sales records match the GST return data?
2. Which records differ, and why?
3. What action should be taken on each difference?
4. Can the final reconciliation be reviewed and exported with a clear audit trail?

The interface must feel dependable and restrained. It should prioritise legibility, explicit labels, and traceable actions over decorative presentation.

### 1.1 Working assumptions

- The first release focuses on outward-supply reconciliation: sales register versus GSTR-1.
- The same experience may later support other comparison pairs, so the UI uses `Source A` and `Source B` internally but always shows meaningful user-facing names such as `Sales register` and `GSTR-1`.
- Users may upload spreadsheet, CSV, PDF, or supported document exports. Spreadsheet and CSV inputs are structured directly; document-like inputs are processed through the Docling service.
- A reconciliation belongs to one organisation, one GSTIN, and one tax period or custom date range.
- Reconciliation processing is asynchronous for large files and may continue if the user leaves the page.
- The document defines the interface and behaviour only. It does not prescribe tax treatment, statutory filing advice, retention periods, or a final accounting policy. Those require domain and compliance approval before implementation.

### 1.2 Product language

Use `reconciliation` consistently. Avoid abbreviations such as `recon` in customer-facing text. Use Indian English and familiar GST terminology.

### 1.3 Requirement traceability

| Design requirement | Defined by this specification |
| --- | --- |
| Minimal design | Experience principles in section 2, application shell in section 6, and restrained component rules in sections 8 and 9 |
| Clear instructions on hover | Contextual help in section 8.4 and the hover/focus/tap contract in section 8.5 |
| No gradients | Explicit prohibition in sections 2.1, 8.10, 9.1, and the acceptance criteria |
| Clear input, output, and action text | Screen-level field copy in section 7 and content rules in section 13 |
| Light and dark support | Paired tokens in section 9 and full theme behaviour in section 10 |
| Mild, non-flashy palette | Low-saturation colour direction and usage limits in section 9.1 |

### 1.4 Scope boundaries

This is a UI/UX design artifact only. It defines what users see, read, and interact with, including screen structure, states, responsive adaptations, accessibility, and interaction feedback. It intentionally does not define:

- Frontend or backend application architecture.
- API endpoints, payloads, or transport behaviour.
- Database schemas, persistence technology, or storage topology.
- Document-processing implementation.
- Hosting, deployment, monitoring, or security architecture.
- GST policy, filing advice, or authoritative tax treatment.

References to loading, processing, saving, permissions, audit history, and extracted content describe required interface states rather than a technical implementation.

---

## 2. Experience principles

### 2.1 Minimal by default

- Show the information needed for the current decision.
- Place advanced rules and secondary metadata behind clearly labelled disclosures.
- Use one primary action per page or panel.
- Prefer whitespace, alignment, and typography to decorative containers.
- Use borders only to establish structure; avoid excessive card nesting.
- Do not use gradients anywhere, including buttons, charts, illustrations, loading states, or backgrounds.

### 2.2 Explicit over clever

- Every input has a persistent visible label.
- Every button names the outcome: `Run reconciliation`, not `Continue`, when that is the action.
- Outputs state their unit, scope, and time period.
- Statuses combine an icon, text label, and mild colour treatment.
- Destructive actions describe the affected object and require confirmation.

### 2.3 Help at the point of need

- A short help icon beside unfamiliar labels exposes instructions on hover and keyboard focus.
- Tooltips explain the term, the expected format, or the consequence of a choice.
- Touch users receive the same help on tap; help must never be hover-only.
- Complex forms include brief inline guidance even before a tooltip is opened.

### 2.4 Calm treatment of exceptions

Mismatch-heavy results are normal and must not make the interface feel alarming. Reserve red for blocked tasks, invalid data, and confirmed errors. Use neutral or amber treatments for unresolved business differences.

### 2.5 Traceable decisions

Every exception action should show who changed it, when it changed, and any supplied note. Final outputs should link back to the source values and rule used to reach the result.

---

## 3. Users and permissions

| Role | Primary goals | Expected permissions |
| --- | --- | --- |
| Finance executive | Upload files, map columns, run reconciliation, resolve routine exceptions | Create and edit reconciliations; export working results |
| Tax reviewer | Review differences, approve decisions, confirm final output | View all; edit decisions; approve or reopen |
| Finance administrator | Manage organisations, GSTINs, rules, members, and retention settings | Full workspace administration |
| Read-only auditor | Inspect source records, decisions, and audit history | View and export approved records; no edits |

Permissions should affect both visibility and action availability. A user must not see an enabled control that the server will later reject. When a useful action is unavailable, show it disabled with a tooltip such as `Only reviewers and administrators can approve a reconciliation.`

---

## 4. Information architecture

### 4.1 Primary navigation

1. **Overview** — workload, recent runs, data-quality notices, and items needing attention.
2. **Reconciliations** — all draft, processing, review, approved, failed, and archived runs.
3. **Exceptions** — unresolved records across reconciliations, if the user has access to more than one run.
4. **Reports** — generated and scheduled exports.
5. **Settings** — organisations, GSTINs, reconciliation rules, team, appearance, and data controls.
6. **Help** — short guides, supported file formats, reconciliation terms, and support access.

On a small screen, primary navigation is exposed through a labelled `Menu` button. Do not use a hamburger icon without the text label.

### 4.2 Global header

The global header contains:

- Product name: `GST Reconciliation`.
- Organisation switcher with the active organisation name and GSTIN context.
- Tax period context when the user is inside a reconciliation.
- Search button labelled `Search` at desktop widths and an icon with an accessible name at compact widths.
- Theme control: `Appearance: Light`, `Appearance: Dark`, or `Appearance: System`.
- Notifications button with unread count.
- User menu with name and role.

### 4.3 Object hierarchy

```text
Organisation
├── GSTIN
│   ├── Reconciliation
│   │   ├── Source files
│   │   ├── Mapping and rules
│   │   ├── Matched records
│   │   ├── Exceptions
│   │   ├── Decisions
│   │   └── Reports
│   └── Saved mapping templates
└── Members and workspace settings
```

---

## 5. Primary end-to-end workflow

```text
Overview
   ↓
New reconciliation
   ↓
Define scope → Add sales register → Add GSTR-1 data → Map fields
   ↓
Validate data → Configure matching rules → Review setup
   ↓
Run reconciliation
   ↓
Results summary → Investigate exceptions → Record decisions
   ↓
Review and approve → Export report
```

### 5.1 Progress model

The creation flow is a stepper with these labels:

1. `Scope`
2. `Sales register`
3. `GSTR-1 data`
4. `Map fields`
5. `Matching rules`
6. `Review and run`

The stepper shows `Completed`, `Current`, `Not started`, and `Needs attention` states using both text and icons. Users may return to completed steps. Skipping ahead is allowed only when all required information for the target step exists.

Draft input is saved automatically after a valid change. A quiet status line shows `Saved just now` or `Could not save changes. Retrying…`. The user should never have to infer whether setup work is retained.

---

## 6. Global application shell

### 6.1 Desktop layout

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ GST Reconciliation   Organisation ▾        Search   Theme   Alerts   User │
├───────────────────┬────────────────────────────────────────────────────────┤
│ Overview          │ Page title                           Primary action     │
│ Reconciliations   │ Short description / context                             │
│ Exceptions        │                                                        │
│ Reports           │ Page content                                            │
│ Settings          │                                                        │
│ Help              │                                                        │
└───────────────────┴────────────────────────────────────────────────────────┘
```

- Header height: 64 px.
- Navigation width: 224 px expanded, 72 px collapsed.
- Content maximum width: 1440 px; data tables may use the full available width.
- Default content padding: 32 px desktop, 24 px tablet, 16 px mobile.
- The content area uses a single page background. Cards are introduced only for independently actionable or semantically grouped content.

### 6.2 Page header pattern

Every page header contains:

- Breadcrumb when nested more than one level.
- One clear H1.
- A one-sentence description when the title alone does not convey the task.
- Optional status and period metadata.
- At most one filled primary action.
- Secondary actions as outlined buttons or an overflow menu.

Example:

```text
Reconciliations / August 2026

August 2026 sales vs GSTR-1                       [Export] [Approve reconciliation]
GSTIN 24ABCDE1234F1Z5 · 1–31 August 2026 · Review required
```

---

## 7. Screen specifications

### 7.1 Overview

#### Purpose

Give users an immediate view of current workload and direct them to the next useful action.

#### Layout

1. Page header with `Overview` and primary action `New reconciliation`.
2. Context strip showing active organisation and GSTIN.
3. Four restrained summary metrics.
4. `Needs attention` work queue.
5. `Recent reconciliations` table.
6. Optional data-quality notice.

#### Summary metrics

| Label | Value example | Supporting text | Click outcome |
| --- | --- | --- | --- |
| Open reconciliations | `4` | `2 need review` | Filtered reconciliation list |
| Unresolved exceptions | `126` | `Across 3 tax periods` | Cross-run exception list |
| Value difference | `₹1,84,230.00` | `Unresolved taxable value` | Exceptions filtered by value mismatch |
| Last approved | `Jul 2026` | `Approved 12 Aug 2026` | Approved reconciliation detail |

Metrics are plain surfaces with a thin border. Values use tabular numerals. Do not use animated counters, oversized coloured blocks, or gradients.

#### Empty state

- Heading: `No reconciliations yet`
- Body: `Create a reconciliation to compare your sales register with GSTR-1 data.`
- Action: `Create first reconciliation`
- Secondary link: `View supported file formats`

### 7.2 Reconciliation list

#### Table columns

- Reconciliation name
- GSTIN
- Tax period
- Status
- Match rate
- Unresolved exceptions
- Last updated
- Owner
- Actions

#### Controls

- Search label: `Search reconciliations`
- Search placeholder: `Search by name, GSTIN, or period`
- Status filter: `All statuses`
- GSTIN filter: `All GSTINs`
- Tax period filter: `All periods`
- Sort default: `Last updated: newest first`
- Primary action: `New reconciliation`

Active filters appear as removable chips below the filter row. `Clear all filters` is shown when two or more filters are active. The results count reads, for example, `24 reconciliations` or `6 of 24 reconciliations` when filtered.

#### Row actions

Show the most likely action directly: `Open` for active work or `View` for approved work. Place `Rename`, `Duplicate setup`, `Archive`, and allowed destructive actions in an overflow menu.

### 7.3 New reconciliation — Scope

#### Purpose

Establish the legal entity and time scope before files are added.

#### Inputs

| Visible label | Control | Instruction text | Example / placeholder | Validation |
| --- | --- | --- | --- | --- |
| Reconciliation name | Text input | `Use a name that identifies the return period.` | `August 2026 sales vs GSTR-1` | Required; 3–80 characters |
| Organisation | Select | `Choose the legal entity that owns this reconciliation.` | `Select organisation` | Required |
| GSTIN | Searchable select | `Only GSTINs belonging to the selected organisation are shown.` | `Select GSTIN` | Required; valid configured GSTIN |
| Period type | Segmented control | `Use Tax period for a monthly or quarterly return. Use Custom range for another review.` | `Tax period` / `Custom range` | Required |
| Tax period | Month or quarter picker | `Select the return period represented by both sources.` | `August 2026` | Required; future periods blocked unless enabled by policy |
| Custom date range | Date-range fields | `Both dates are included.` | `DD/MM/YYYY` | Start must precede end; maximum range set by workspace policy |
| Currency | Read-only field | `GST reconciliation values are displayed in this currency.` | `INR — Indian Rupee` | Fixed in initial release |

Primary action: `Save and add sales register`.

Secondary action: `Cancel setup`. If the draft has saved data, confirmation text is `Leave this draft? Your saved setup will remain in Reconciliations.`

### 7.4 Add source data

The sales-register and GSTR-1 steps share one source-input pattern with source-specific content.

#### Source choice

Label: `How would you like to add the sales register?`

Options:

- `Upload a file` — `Add an XLSX, XLS, CSV, or supported document file.`
- `Choose an existing source` — `Reuse a previously uploaded source if permitted by data-retention policy.`
- `Connect a data source` — only shown when a real integration is configured; never show a non-functional placeholder.

#### Upload zone

Visible content:

- Heading: `Drop the sales register here`
- Supporting text: `or choose a file from your device`
- Button: `Choose file`
- Limits: `XLSX, XLS, CSV, PDF · Maximum 50 MB per file`
- Privacy note: `Your file is stored and processed according to your organisation's data policy.`

The complete drop zone is clickable, but the `Choose file` button remains visibly distinct. Drag states change border and surface colour only. Do not animate the border continuously.

#### File row

Show:

- File name and extension
- File size
- Upload progress as a labelled progress bar
- Processing state
- Sheet selector for workbooks
- `Replace file` and `Remove file` actions

State copy:

| State | Message |
| --- | --- |
| Uploading | `Uploading sales-register-aug-2026.xlsx — 64%` |
| Inspecting | `Checking file structure…` |
| Document processing | `Extracting tables from the document…` |
| Ready | `File ready · 2,418 rows found` |
| Warning | `File ready with 12 rows that need attention` |
| Failed | `We could not read this file. Check the file format and try again.` |

#### Sheet and header selection

- Label: `Data sheet`
- Help: `Choose the worksheet containing invoice-level sales records.`
- Label: `Header row`
- Help: `Select the row containing column names. Data begins on the next row.`
- Preview caption: `Previewing rows 1–10 from Sales Register`

The preview table must show raw source values and must not silently normalise them. Any display-only formatting is identified with a tooltip.

Primary actions:

- Sales register step: `Save and add GSTR-1 data`
- GSTR-1 step: `Save and map fields`

### 7.5 Map fields

#### Purpose

Map source columns to a shared GST schema and make data interpretation visible.

#### Layout

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Map fields                              10 of 12 required fields mapped  │
│ Match each required field with a column from both files.                 │
├───────────────────┬─────────────────────┬────────────────────────────────┤
│ Reconciliation    │ Sales register      │ GSTR-1 data                   │
│ field             │ column              │ column                         │
├───────────────────┼─────────────────────┼────────────────────────────────┤
│ Invoice number ?  │ [Invoice No.     ▾] │ [inum                       ▾] │
│ Invoice date ?    │ [Invoice Date    ▾] │ [idt                        ▾] │
│ Taxable value ?   │ [Taxable Amount  ▾] │ [txval                      ▾] │
└───────────────────┴─────────────────────┴────────────────────────────────┘
```

#### Required shared fields

- Invoice number
- Invoice date
- Customer GSTIN, where applicable
- Document type
- Taxable value
- GST rate or tax-rate components
- IGST amount
- CGST amount
- SGST/UTGST amount
- Cess amount, if present
- Place of supply, when relevant to the source type
- Invoice total

Optional fields may include customer name, reverse-charge indicator, e-commerce operator GSTIN, reference number, original invoice reference, and source notes.

#### Mapping row behaviour

- Each shared field has a help icon explaining what it represents and an example value.
- Each selector shows detected source headers and three sample values.
- Auto-detected mappings display a neutral badge `Suggested` until the user confirms or runs validation.
- Confidence is described with text (`High confidence`, `Review suggested`) rather than a bright score or colour alone.
- Selecting an already-mapped source column prompts: `This column is currently mapped to Invoice total. Move it to Taxable value?`
- `Not available in this source` is an explicit option for optional fields only.

#### Saved template

Offer `Save this mapping as a template` after a valid mapping exists. Supporting text: `Templates are available only for this organisation and source format.` Never apply a stored template silently; show `Applied template: Tally sales export` with `Review mapping`.

Primary action: `Validate mapped data`.

### 7.6 Data validation

Validation occurs before matching and separates blocking errors from reviewable warnings.

#### Validation summary

```text
Data validation
2,418 sales rows · 2,403 GSTR-1 rows

[2 blocking issues] [18 warnings] [4,801 valid rows]
```

#### Issue groups

- Missing required values
- Invalid GSTIN format
- Invalid or out-of-period dates
- Non-numeric amounts
- Duplicate source records
- Unsupported document types
- Tax component inconsistencies
- Rows omitted by filters

#### Issue table columns

- Severity
- Source
- Row
- Field
- Current value
- Issue
- Suggested action

Actions: `Download issue list`, `Replace source file`, `Return to mapping`, and where safe, `Exclude selected rows`.

Exclusion requires a reason and creates an audit entry. It does not edit the uploaded source. Show: `Excluded rows remain visible in the audit report and are not included in matching.`

Blocking copy: `Resolve 2 blocking issues before configuring matching rules.`

Warning copy: `Warnings do not prevent reconciliation, but they may affect the result.`

### 7.7 Matching rules

#### Default rule set

Rules are arranged from strongest identity match to controlled tolerance:

1. Exact document type, invoice number, customer GSTIN, and invoice date.
2. Normalised invoice number match when permitted.
3. Date tolerance.
4. Taxable-value and tax-amount tolerance.
5. Composite fallback matching only when explicitly enabled and approved.

#### Inputs and copy

| Label | Control | Guidance |
| --- | --- | --- |
| Invoice number comparison | Select | `Choose whether spaces, hyphens, and letter case may be ignored.` |
| Invoice date tolerance | Number + unit | `Allow dates to differ by up to this many calendar days.` |
| Taxable value tolerance | Currency input | `Records within this absolute difference can be treated as matched.` |
| Tax amount tolerance | Currency input | `Applied to the combined GST amount unless component matching is enabled.` |
| Match tax components separately | Switch | `Compare IGST, CGST, SGST/UTGST, and cess independently.` |
| Detect possible duplicates | Switch | `Flag records with repeated identity fields for review.` |
| Use fallback matching | Switch | `May produce possible matches that require manual confirmation.` |

Avoid ambiguous switch labels such as `Strict mode`. State exactly what changes. When a rule can affect compliance interpretation, add `Confirm this rule with your tax reviewer.`

#### Rule summary

Before leaving the step, render a plain-language summary:

> Invoice numbers will ignore letter case and spaces. Invoice dates may differ by 2 days. Taxable value and total GST may differ by up to ₹1.00. Possible fallback matches will require review.

Primary action: `Save rules and review setup`.

### 7.8 Review and run

#### Review sections

- Scope: organisation, GSTIN, period, and reconciliation name.
- Sales register: file, sheet, row count, upload time.
- GSTR-1: file, sheet or source, row count, upload time.
- Mapping: mapped, optional omitted, and flagged mappings.
- Data validation: blocking errors and warnings.
- Matching rules: readable summary.

Each section has an `Edit` link with an accessible name such as `Edit sales register source`.

#### Confirmation

Checkbox label: `I have reviewed the source files, mappings, and matching rules.`

Primary button: `Run reconciliation`.

If processing can take time, state before submission: `You can leave this page after processing starts. We will notify you when results are ready.`

### 7.9 Processing state

#### Content

- Heading: `Reconciling August 2026 data`
- Progress label: `Comparing records — 62%`
- Current stage text
- Processed row count when available
- Start time and elapsed time
- Action: `Continue in background`
- Secondary action: `Cancel reconciliation` only if cancellation is safe and supported

Do not display fabricated precision. If progress cannot be reliably calculated, use an indeterminate, non-gradient activity indicator and stage text instead of a percentage.

Stages:

1. `Preparing source data`
2. `Checking exact matches`
3. `Checking tolerance rules`
4. `Identifying exceptions`
5. `Preparing results`

### 7.10 Results summary

#### Page header

- Title: reconciliation name
- Context: GSTIN, tax period, last processed time
- Status: `Review required`, `Ready for approval`, `Approved`, or `Processing failed`
- Actions: `Export` and role-appropriate `Approve reconciliation`

#### Result metrics

| Metric | Meaning | Example secondary text |
| --- | --- | --- |
| Matched | Source records meeting the accepted rules | `2,116 records · ₹48,23,140 taxable value` |
| Possible matches | Candidate pairs requiring confirmation | `34 record pairs` |
| Only in sales register | Records without an accepted GSTR-1 pair | `146 records` |
| Only in GSTR-1 | Records without an accepted sales pair | `107 records` |
| Value differences | Paired records with amount differences beyond tolerance | `18 records · ₹1,84,230 difference` |
| Duplicate or invalid | Records needing source-data review | `7 records` |

Use a slim segmented distribution bar only as a secondary visual. Each segment has a text legend, count, and percentage. The bar uses flat solid fills and remains understandable without colour.

#### Tax summary

Provide a side-by-side table:

| Tax component | Sales register | GSTR-1 | Difference |
| --- | ---: | ---: | ---: |
| Taxable value | ₹48,23,140.00 | ₹46,38,910.00 | ₹1,84,230.00 |
| IGST | ₹3,18,200.00 | ₹3,06,740.00 | ₹11,460.00 |
| CGST | ₹1,26,840.00 | ₹1,24,720.00 | ₹2,120.00 |
| SGST/UTGST | ₹1,26,840.00 | ₹1,24,720.00 | ₹2,120.00 |
| Cess | ₹0.00 | ₹0.00 | ₹0.00 |

Above the table state: `Amounts shown in INR for 1–31 August 2026.` Negative values use a minus sign before the currency symbol and include a text cue where meaning is not obvious.

#### Next action panel

Display only one recommendation based on state:

- `Review 34 possible matches`
- `Resolve 271 unmatched records`
- `Review 18 value differences`
- `Reconciliation is ready for approval`

### 7.11 Results explorer

#### Tabs

- `All records`
- `Matched`
- `Possible matches`
- `Only in sales register`
- `Only in GSTR-1`
- `Value differences`
- `Duplicates and invalid`

Each tab includes a count. The active tab uses a border and type weight, not colour alone.

#### Toolbar

- Search label: `Search records`
- Placeholder: `Invoice number, GSTIN, or customer name`
- Filter button: `Filters` plus active count
- Group action: `Review selected`
- Export action: `Export current view`
- Column action: `Columns`
- Saved-view action: `Save view`

#### Core columns

- Select
- Status
- Invoice number
- Invoice date
- Customer GSTIN
- Customer name
- Document type
- Sales taxable value
- GSTR-1 taxable value
- Difference
- GST difference
- Decision
- Assignee
- Updated
- Row actions

Amounts align right and use tabular numerals. Column headings remain visible in a sticky header. The invoice identity columns may be frozen on wide screens. Horizontal scrolling must not hide the row status or selected state.

#### Table density

Default row height is 48 px. Users may choose `Comfortable` at 56 px or `Compact` at 40 px. Compact mode must preserve a minimum 32 px action target and is not the default on touch devices.

#### Pagination

Use server-backed pagination for large datasets. Copy: `Showing 1–50 of 2,418 records`. Controls are labelled `Previous page` and `Next page`. Page size options: 25, 50, 100.

### 7.12 Exception detail

Open exception detail in a right-side panel on desktop and a full page on narrow screens. The URL changes so the record can be shared and restored.

#### Panel structure

1. Header: exception category, invoice number, status, close button.
2. Plain-language explanation.
3. Side-by-side source values.
4. Matching evidence and applied tolerances.
5. Source-row links.
6. Decision controls.
7. Notes and activity history.

#### Comparison pattern

```text
Field                 Sales register          GSTR-1                 Difference
Invoice number        INV-1082                INV1082                 Formatting
Invoice date          18/08/2026              19/08/2026              1 day
Taxable value         ₹12,500.00              ₹12,000.00              ₹500.00
IGST                  ₹2,250.00               ₹2,160.00               ₹90.00
```

Changed values use a mild background highlight plus a `Different` label where needed. Do not rely on red/green comparisons alone.

#### Decision controls

Label: `Resolution`

Options must be configured and domain-approved. Suggested design labels are:

- `Accept as matched`
- `Keep as mismatch`
- `Correct sales register`
- `Correct GSTR-1 data`
- `Defer to next period`
- `Not applicable`

Label: `Resolution note`

Instruction: `Explain the reason for this decision. This note will appear in the audit report.`

Placeholder: `Add a clear reason for the reviewer…`

Actions: `Save resolution` and `Save and open next`.

Where policy requires approval, a finance executive's decision shows `Pending reviewer approval` instead of appearing final.

### 7.13 Bulk resolution

Bulk actions are allowed only for records of a compatible exception type. The confirmation screen shows:

- Number of affected records
- Current filter or selection basis
- Proposed resolution
- Required note
- Effect on unresolved counts and values

Confirmation button names the action: `Apply resolution to 24 records`.

Do not permit bulk acceptance of possible matches if each pair has materially different evidence or if workspace policy blocks it.

### 7.14 Review and approval

#### Readiness checklist

- `No blocking data issues`
- `All possible matches reviewed`
- `All exceptions resolved or explicitly deferred`
- `Tax summary reviewed`
- `Required resolution notes present`

Unmet items link to the relevant filtered view.

Approval dialog:

- Heading: `Approve August 2026 reconciliation?`
- Body: `Approval locks source mappings, matching rules, and resolutions. An administrator may reopen the reconciliation, which will be recorded in the audit history.`
- Checkbox: `I confirm that I reviewed the reconciliation summary and outstanding items.`
- Optional/required approval note based on policy.
- Primary: `Approve reconciliation`
- Secondary: `Cancel`

After approval, editing actions are replaced with `Reopen reconciliation` for authorised roles. Reopening requires a reason.

### 7.15 Reports and export

#### Export dialog

Label: `Report type`

- `Reconciliation summary`
- `Detailed record comparison`
- `Unresolved exceptions`
- `Resolution and audit history`
- `Data validation issues`

Label: `File format`

- `Excel workbook (.xlsx)`
- `CSV files (.zip)` when multiple tables are required
- `PDF report (.pdf)` for human review

Label: `Records to include`

- `All records`
- `Current filtered view`
- `Selected records`

Checkbox: `Include source row references`.

Primary: `Generate report`.

Report generation state reads `Preparing detailed record comparison…`. When ready, show file name, size, generated time, expiry if applicable, and `Download report`. Never show a download action before a real file exists.

### 7.16 Settings

Settings are grouped into:

- `Organisations and GSTINs`
- `Mapping templates`
- `Matching rule sets`
- `Team and permissions`
- `Appearance`
- `Notifications`
- `Data retention and deletion`

#### Appearance

Control label: `Colour mode`

Options:

- `Use device setting`
- `Light`
- `Dark`

Help: `Use device setting follows your operating system and updates automatically.`

The selected mode is applied immediately and stored per user. The screen must not flash the wrong theme during a normal signed-in load.

---

## 8. Component specification

### 8.1 Buttons

| Type | Use | Visual treatment |
| --- | --- | --- |
| Primary | One main page or dialog action | Solid accent fill, high-contrast text |
| Secondary | Important alternative | Transparent or surface fill, standard border |
| Tertiary | Low-emphasis contextual action | Text and optional icon, no persistent container |
| Destructive | Confirmed deletion or irreversible action | Solid danger only in confirmation; otherwise outlined/text danger |
| Icon button | Compact universal action | Icon plus accessible name and tooltip; text preferred where room permits |

Button labels use sentence case. Minimum height is 40 px, with a 44 × 44 px touch target. Loading buttons retain their width and change label, for example `Generating report…`. Disabled buttons maintain readable text and explain the condition through adjacent guidance or a focusable wrapper tooltip.

### 8.2 Inputs

Every field follows this order:

1. Visible label
2. Optional help icon
3. Control
4. Persistent guidance when necessary
5. Validation or status message

Placeholders provide examples, not labels. Required fields use the text `Required` where the form contains a mix of required and optional fields. Optional fields use `Optional`; do not communicate required status with an asterisk alone.

Input states:

- Rest
- Hover
- Focus
- Filled
- Disabled
- Read-only
- Valid, only when confirmation adds value
- Warning
- Error
- Loading, for remote selectors

Errors name both the issue and correction: `Enter a valid GSTIN in the format 24ABCDE1234F1Z5.`

### 8.3 Selectors and comboboxes

- Use native-like selects for short static lists.
- Use searchable comboboxes for GSTINs, organisations, assignees, and long lists.
- Selected value remains visible after focus moves.
- No-results copy: `No GSTINs match “24ABC”.`
- Loading copy: `Loading GSTINs…`
- Failed copy: `GSTINs could not be loaded. Retry.`

### 8.4 Tooltips and contextual help

#### Trigger

- Use a 16 px circled question-mark icon beside the label.
- Accessible name: `Help: {field name}`.
- Open on pointer hover after 300 ms, keyboard focus immediately, and tap.
- Close on pointer leave after a short grace period, Escape, focus exit, outside click, or a second tap.
- Keep the trigger focusable and the tooltip content associated through accessibility attributes.

#### Content rules

- One to three short sentences, ideally under 240 characters.
- Start with the action or definition, not `This field is…`.
- Include a concrete example when format is important.
- State the consequence when the choice changes matching or reporting.
- Link to full help only when the explanation cannot remain concise.
- Never place essential error recovery only in a tooltip.

#### Tooltip examples

| Label | Tooltip text |
| --- | --- |
| Tax period | `Choose the GST return period represented by both source files.` |
| Customer GSTIN | `The recipient's 15-character GST identification number. Example: 24ABCDE1234F1Z5.` |
| Invoice date tolerance | `Allows otherwise matching records to have dates this many calendar days apart.` |
| Possible match | `The records are similar but do not satisfy every confirmed matching rule. Review before accepting.` |
| Value difference | `Sales-register and GSTR-1 amounts differ by more than the accepted tolerance.` |
| Exclude row | `Removes this row from matching, but keeps it in the validation and audit reports.` |
| Match rate | `Matched records divided by the unique records considered after validation exclusions.` |

#### Placement

Prefer top or bottom placement and keep the tooltip inside the viewport. Maximum width is 320 px. Use an opaque solid background with a subtle border; no translucency that reduces readability.

### 8.5 Hover and discovery contract

Hover provides clarification and feedback; it must not be the only way to find an action. All controls remain visible or available through a clearly labelled menu before hover.

| Interactive element | Visible before hover | Hover or focus response | Instruction pattern |
| --- | --- | --- | --- |
| Labelled button | Action text and control boundary | Mild solid-colour state change; pointer where appropriate | Do not repeat obvious labels in a tooltip; show extra consequence only when useful |
| Icon-only button | Recognisable icon and accessible name | Tooltip names the action | `Close exception details`, `Copy GSTIN`, `More actions` |
| Help icon | Question-mark icon beside the term | Tooltip explains use, format, or consequence | Use the examples in section 8.4 |
| Disabled action | Readable disabled control | Focusable wrapper or adjacent help explains why unavailable | `Resolve all blocking issues before running reconciliation.` |
| Sortable heading | Heading and sort indicator area | Background changes; tooltip or accessible description names the result | `Sort by taxable value, highest first` |
| Truncated value | Visible shortened text with ellipsis | Tooltip exposes the complete unmodified value | Full file name, customer name, or identifier |
| Table row | All primary row actions remain discoverable | Quiet row highlight; secondary overflow may gain emphasis | No instruction is required unless an unfamiliar icon is used |
| Chart mark | Legend and table equivalent remain available | Tooltip shows exact category, amount, count, percentage, period, and source | `Only in sales register · 146 records · ₹3,42,600 taxable value` |
| File drop zone | Border, heading, formats, and `Choose file` button | Border and solid background become slightly stronger | `Drop the file to upload it` only during an active drag |

Hover styling must not shift layout, reveal essential text over other content, or use dramatic colour changes. Keyboard focus receives the same instruction as hover, and tap opens an equivalent popover on touch devices.

### 8.6 Badges and statuses

Use badges only for compact status metadata.

| Status | Icon concept | Semantic tone |
| --- | --- | --- |
| Draft | Pencil | Neutral |
| Uploading / Processing | Activity circle | Informational |
| Review required | Eye or review document | Warning |
| Ready for approval | Check in circle | Informational-positive |
| Approved | Check seal | Success |
| Failed | Alert octagon | Danger |
| Archived | Archive box | Neutral |

Badge text is never omitted. Animation is limited to the active processing icon and must respect reduced-motion preferences.

### 8.7 Dialogs

- Use dialogs for short decisions, not multi-step work.
- Heading names the decision.
- Body explains impact.
- Primary and secondary actions are always visible without hover.
- Initial focus moves to the heading or first safe field, not the destructive button.
- Escape closes non-critical dialogs.
- Destructive dialogs do not close on an accidental outside click.

### 8.8 Toasts and persistent messages

Toasts confirm low-risk transient outcomes such as `Resolution saved`. Important failures remain visible near the affected content. A toast should not be the only place an error or generated-report link exists.

Suggested duration:

- Success: 4 seconds
- Informational: 6 seconds
- Error requiring action: persistent until dismissed or resolved

### 8.9 Loading and empty states

- Use flat, solid skeleton blocks only when the expected structure is known.
- Use a labelled progress bar for measurable work.
- Use a compact activity icon and specific verb for unknown duration.
- Avoid generic `Loading…` when `Loading reconciliation results…` is possible.
- Empty states explain whether no data exists, filters removed all results, or the user lacks access.

### 8.10 Data visualisation

Charts are secondary to exact tables. Use only when they improve comparison across categories or periods.

- Solid fills only; no gradients, glow, or 3D effects.
- Direct labels where space allows.
- A legend includes category name, value, and marker shape.
- Patterns or distinct strokes supplement colour for critical categories.
- Tooltips show full category, exact value, percentage, period, and source.
- Provide a table equivalent for any chart containing decision-critical values.

---

## 9. Visual design system

### 9.1 Colour direction

The palette is mild and low-saturation. Green is used as the product accent because it feels stable and appropriate for financial work, not to imply that every green item is successful. Semantic states remain separate from the brand accent.

All surfaces use solid colour. Gradients are prohibited.

#### Light mode tokens

| Token | Value | Intended use |
| --- | --- | --- |
| `background` | `#F6F8F6` | Application canvas |
| `surface` | `#FFFFFF` | Cards, dialogs, table surfaces |
| `surface-subtle` | `#EFF2EF` | Hover rows, grouped regions |
| `surface-raised` | `#FAFBFA` | Raised but quiet content |
| `border` | `#D5DCD7` | Standard dividers and controls |
| `border-strong` | `#89968E` | Control outlines and emphasised boundaries |
| `text-primary` | `#19221C` | Main text |
| `text-secondary` | `#526058` | Supporting text |
| `text-disabled` | `#7D8981` | Disabled text on disabled surfaces |
| `text-on-accent` | `#FFFFFF` | Text and icons on accent fills |
| `accent` | `#356A55` | Primary actions and active controls |
| `accent-hover` | `#2C5947` | Primary hover |
| `accent-subtle` | `#E4EFE9` | Selected backgrounds |
| `focus` | `#426F86` | Focus ring |
| `info` | `#416B7B` | Informational status |
| `info-subtle` | `#E7F0F3` | Informational background |
| `success` | `#356B4E` | Confirmed success |
| `success-subtle` | `#E6F1EA` | Success background |
| `warning` | `#80611F` | Review-needed status |
| `warning-subtle` | `#F6EFD9` | Warning background |
| `danger` | `#9A4242` | Errors and destructive actions |
| `danger-subtle` | `#F7E8E8` | Error background |
| `overlay` | `#19221C99` | Modal scrim only |

#### Dark mode tokens

| Token | Value | Intended use |
| --- | --- | --- |
| `background` | `#111613` | Application canvas |
| `surface` | `#19201B` | Cards, dialogs, table surfaces |
| `surface-subtle` | `#222B25` | Hover rows, grouped regions |
| `surface-raised` | `#1D261F` | Raised content |
| `border` | `#39463E` | Standard dividers and controls |
| `border-strong` | `#68796F` | Control outlines and emphasised boundaries |
| `text-primary` | `#EEF3EF` | Main text |
| `text-secondary` | `#B4BEB7` | Supporting text |
| `text-disabled` | `#7F8C84` | Disabled text |
| `text-on-accent` | `#111613` | Text and icons on accent fills |
| `accent` | `#80B39A` | Primary actions and active controls |
| `accent-hover` | `#94C2AA` | Primary hover |
| `accent-subtle` | `#233B30` | Selected backgrounds |
| `focus` | `#82B3CA` | Focus ring |
| `info` | `#88B7C8` | Informational status |
| `info-subtle` | `#21373F` | Informational background |
| `success` | `#85B99A` | Confirmed success |
| `success-subtle` | `#20392A` | Success background |
| `warning` | `#D0AF65` | Review-needed status |
| `warning-subtle` | `#3A321F` | Warning background |
| `danger` | `#E09595` | Errors and destructive actions |
| `danger-subtle` | `#432828` | Error background |
| `overlay` | `#000000B3` | Modal scrim only |

#### Colour usage rules

- Text and interactive-control combinations must meet WCAG 2.2 AA contrast; large financial figures should meet the normal-text threshold where practical.
- Use `border-strong` for input and button boundaries when the boundary is required to identify the control; reserve `border` for non-essential dividers.
- Do not rely on colour alone for status, selection, gains/losses, errors, or chart categories.
- Primary accent should occupy a small proportion of the page.
- Reserve danger colour for real errors and destructive actions, not ordinary mismatches.
- Avoid pure black and pure white as broad canvas colours to reduce glare.
- Disabled controls must remain readable; opacity alone must not make content illegible.

### 9.2 Typography

Use a system-first sans-serif stack for reliable rendering:

`Inter, "Noto Sans", "Segoe UI", Roboto, Arial, sans-serif`

Use `"Noto Sans Devanagari"` in the fallback chain if multilingual support is added.

| Style | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| Display | 32 / 40 px | 650 | Rare top-level welcome heading |
| H1 | 28 / 36 px | 650 | Page title |
| H2 | 22 / 30 px | 650 | Major section |
| H3 | 18 / 26 px | 600 | Card and panel heading |
| Body | 14 / 22 px | 400 | Default application copy |
| Body large | 16 / 24 px | 400 | Introductory and dialog copy |
| Label | 13 / 18 px | 600 | Field labels and compact controls |
| Caption | 12 / 18 px | 400 | Metadata and supporting text |
| Metric | 24 / 32 px | 650 | Summary values |

Use tabular numeral variants for all aligned monetary values, percentages, counts, dates, and row identifiers. Avoid all-caps labels except recognised source abbreviations such as GSTIN, CSV, and PDF.

### 9.3 Spacing

Use a 4 px base unit.

| Token | Value | Typical use |
| --- | ---: | --- |
| `space-1` | 4 px | Tight icon gap |
| `space-2` | 8 px | Label-to-control and compact padding |
| `space-3` | 12 px | Related content spacing |
| `space-4` | 16 px | Standard component padding |
| `space-5` | 20 px | Dense section gap |
| `space-6` | 24 px | Card padding and section gap |
| `space-8` | 32 px | Page grouping |
| `space-10` | 40 px | Major vertical separation |
| `space-12` | 48 px | Sparse desktop separation |

### 9.4 Shape and depth

- Input and button radius: 6 px.
- Card and panel radius: 8 px.
- Badge radius: 999 px only for compact status pills.
- Default border: 1 px.
- Use shadows sparingly for dialogs, menus, and overlapping panels only.
- Default shadow: `0 8px 24px` with a low-opacity neutral colour appropriate to the theme.
- Do not create depth with gradients, glow, glass effects, or heavy shadows.

### 9.5 Iconography

- Use a consistent 1.5–2 px outline icon family.
- Default size: 18–20 px; 16 px for inline help.
- Icons accompany text for unfamiliar or high-consequence actions.
- Icon-only controls are acceptable only for universal actions such as close, with an accessible name and tooltip.
- Avoid decorative illustrations unless a user study shows that an empty state needs one; prefer a simple outline graphic in one neutral colour.

### 9.6 Motion

- Standard transition duration: 120–180 ms.
- Use motion only to clarify state change, panel entry, or focus.
- No decorative bouncing, pulsing metrics, parallax, or continuously moving backgrounds.
- Respect `prefers-reduced-motion`; replace movement with immediate state changes or opacity-free progress updates.

---

## 10. Theme behaviour

### 10.1 Theme selection

- New signed-out or unidentified users default to the operating-system preference.
- Signed-in choice is stored per user.
- `System` mode listens for operating-system changes.
- Theme switching is immediate and does not reload the page or discard form state.
- Every component must use semantic tokens rather than hardcoded light colours.

### 10.2 Dark-mode quality requirements

- Dark mode is designed independently, not produced by inverting light mode.
- Surfaces use subtle lightness changes and borders to establish hierarchy.
- Data tables, sticky columns, tooltips, menus, charts, native form controls, upload zones, and document previews all receive dark-mode treatment.
- Uploaded document previews may retain the document's original white page, enclosed by a dark neutral viewer and labelled `Document preview`.
- Status colours are softened to prevent glow while preserving contrast.
- Focus rings remain clearly visible against every dark surface.

### 10.3 Theme QA matrix

Test every component in:

- Light / default
- Light / hover
- Light / keyboard focus
- Light / error and disabled
- Dark / default
- Dark / hover
- Dark / keyboard focus
- Dark / error and disabled
- High zoom at 200% in both modes
- Forced-colours mode where supported

---

## 11. Responsive behaviour

### Breakpoints

| Name | Width | Behaviour |
| --- | --- | --- |
| Compact | `< 640 px` | Single column; full-page detail; mobile navigation |
| Medium | `640–1023 px` | Collapsible navigation; two-column forms where safe |
| Wide | `1024–1439 px` | Persistent navigation; standard desktop layout |
| Extra wide | `≥ 1440 px` | Centred content; expanded data-table workspace |

### Compact-screen adaptations

- Stepper becomes `Step 2 of 6 — Sales register` with a `View all steps` disclosure.
- Form fields stack vertically.
- Result metrics use a two-column grid, then one column below 420 px.
- Exception side panel becomes a full-screen route.
- Data table keeps a compact identity column and opens a labelled row-detail view; do not reduce all data to unlabelled cards.
- Primary bottom action may become sticky when it does not cover content or keyboard input.
- Tooltips open as anchored popovers or compact bottom sheets and include a visible close button.
- Hover enhancements are never required to discover an action.

---

## 12. Accessibility requirements

Target WCAG 2.2 Level AA.

### 12.1 Keyboard and focus

- All controls are reachable in a logical order.
- Focus is visible with a 2 px ring and sufficient offset.
- Skip link: `Skip to main content`.
- Dialog focus is contained and returned to the trigger on close.
- Side panels announce their heading and state change.
- Table row actions can be reached without traversing hidden content.
- Drag-and-drop always has a keyboard-operable file picker equivalent.

### 12.2 Semantics and announcements

- One H1 per page, followed by a logical heading hierarchy.
- Tables use true headers, captions, and sort-state announcements.
- Form errors are programmatically tied to their fields.
- Progress changes are announced at meaningful intervals, not every percentage point.
- Toasts use the appropriate polite or assertive live-region behaviour.
- Status icons are decorative when adjacent status text already supplies the meaning.

### 12.3 Visual accessibility

- Normal text contrast at least 4.5:1.
- Large text and essential graphics at least 3:1.
- Focus indicators and component boundaries meet non-text contrast requirements.
- Content reflows at 400% zoom without loss of function, except genuinely two-dimensional data tables, which may scroll.
- Text remains usable at 200% browser zoom.
- Colour is always supplemented with text, icon, pattern, border, or position.

### 12.4 Language and formats

- Dates display as `DD MMM YYYY` in narrative contexts and `DD/MM/YYYY` in compact structured fields.
- Currency displays as `₹12,34,567.00`, following Indian digit grouping.
- Machine-readable values retain exact decimal precision independently from display formatting.
- Avoid unexplained tax acronyms. Where GST terms are necessarily abbreviated, expose a tooltip or glossary definition.

---

## 13. Content and microcopy guide

### 13.1 Voice

The voice is precise, calm, direct, and non-judgemental.

Prefer:

- `18 records have value differences.`
- `Choose the column containing invoice dates.`
- `We could not process 4 rows because the invoice date is missing.`

Avoid:

- `Oops! Something went wrong!`
- `Bad records`
- `Invalid!`
- `Click here`
- `Submit`

### 13.2 Action labels

| Avoid | Use |
| --- | --- |
| Submit | Run reconciliation |
| OK | Save resolution |
| Yes | Archive reconciliation |
| Next | Save and map fields |
| Download | Download detailed report |
| Fix | Review invalid rows |

### 13.3 Input and output distinction

Inputs use action-oriented labels and visible control boundaries. Outputs use descriptive headings, units, scope, and timestamps.

Example input block:

```text
Taxable value tolerance
[ ₹ 1.00                         ]
Records within this absolute difference can be treated as matched.
```

Example output block:

```text
Unresolved taxable value difference
₹1,84,230.00
271 records · INR · 1–31 August 2026
```

### 13.4 Error message structure

1. What happened.
2. Why, if known.
3. What the user can do.
4. Whether their work is safe.

Example: `The GSTR-1 file could not be processed because its workbook structure is damaged. Export it again as XLSX or CSV and replace the file. Your sales-register setup has been saved.`

### 13.5 Confirmation copy

Confirm only actions that are destructive, difficult to reverse, or unusually consequential. Include object name, impact, and recovery path.

Example: `Remove GSTR1-Aug-2026.xlsx? Its field mapping will also be removed. You can upload the file again, but the mapping must be reviewed.`

---

## 14. State and failure design

### 14.1 Application states

Every major screen must define:

- Initial loading
- Loaded with data
- Empty
- Filtered empty
- Partial data
- Recoverable error
- Permission denied
- Offline or connection interrupted
- Session expired

### 14.2 Partial failure boundaries

Feature failures should remain isolated:

- If a chart fails, exact result tables remain available and the chart area shows `Summary chart unavailable` with `Retry`.
- If report generation fails, results and saved decisions remain intact.
- If Docling document processing fails, the user can replace the document or use a structured file without losing the rest of the draft.
- If notification delivery fails, in-product processing status remains available.
- If an activity history fails to load, resolution controls are blocked only if audit integrity requires it; otherwise show the failure locally.

### 14.3 Connection interruption

Persistent banner: `Connection interrupted. Changes will be saved when you are back online.`

If offline edits are not safely supported, use: `Connection interrupted. Copy any unsaved note before leaving this page.` Do not falsely claim offline saving.

When connection returns: `Connection restored. Your latest changes are saved.`

### 14.4 Concurrent editing

If another user changes the same exception:

- Show `This record was updated by Ananya Shah at 14:32.`
- Preserve the current unsaved note locally.
- Offer `Review latest version`.
- Never overwrite the newer decision silently.

---

## 15. Notifications

### In-product notifications

- Reconciliation completed
- Reconciliation failed
- Reconciliation assigned for review
- Exception assigned to the user
- Reconciliation approved or reopened
- Report ready or failed

Notification text includes the object, outcome, and useful action.

Example: `August 2026 sales vs GSTR-1 is ready. Review 34 possible matches.`

Email notifications, if implemented, must link to the actual authorised record and must not contain sensitive row-level values unless approved by policy.

---

## 16. Data trust, privacy, and audit design

The UI must not promise specific security controls until engineering and compliance confirm them. It should nevertheless provide clear locations for verified trust information.

### Required interface behaviours

- Show the active organisation and GSTIN during setup and review.
- Display file name, size, uploader, upload time, and processing status.
- Make source replacement and deletion consequences explicit.
- Show when a mapping or rule set came from a saved template.
- Record source exclusion, manual match, resolution, approval, reopening, and export events.
- Surface server-confirmed actor and timestamp values in the activity history.
- Prevent sensitive values from appearing in URL query text, toast previews, or general notification subjects.
- Time-bound report downloads where policy requires it and display the expiry.
- Make retention and deletion controls visible only when a real policy and backend action exist.

### Audit event presentation

Each event includes:

- Action in plain language
- Actor name and role
- Date and time with timezone
- Previous and new value for material changes
- Reason or note
- Source IP/device only if policy permits and the information is useful

Example: `Priya Mehta accepted INV-1082 as matched · 18 Aug 2026, 15:42 IST · “Invoice number formatting differs; values confirmed.”`

---

## 17. Design acceptance criteria

The design is implemented correctly only when all applicable criteria pass.

### Visual and theme

- [ ] No gradient is used in any component, chart, state, or theme.
- [ ] The palette remains low-saturation and restrained.
- [ ] Light and dark modes cover every surface and state.
- [ ] System, light, and dark preferences work without losing page state.
- [ ] Text and non-text contrast meet WCAG 2.2 AA.
- [ ] Financial figures use consistent Indian currency formatting and tabular numerals.

### Clarity

- [ ] Every input has a persistent visible label.
- [ ] Placeholders are examples, not replacements for labels.
- [ ] Primary actions describe their actual result.
- [ ] Every output states relevant unit, scope, period, or updated time.
- [ ] Destructive actions identify the affected object and impact.
- [ ] Empty, loading, partial, failed, and permission states have specific copy.

### Help and interaction

- [ ] Unfamiliar GST and reconciliation terms have concise contextual help.
- [ ] Help opens on hover, focus, and tap.
- [ ] Essential instructions are not available only on hover.
- [ ] Tooltips stay inside the viewport and are keyboard dismissible.
- [ ] Disabled consequential actions explain how to become available.
- [ ] All interactions have visible hover, focus, active, disabled, and error states.

### Workflow and data trust

- [ ] The active organisation, GSTIN, and tax period are visible at consequential steps.
- [ ] Uploaded files show real processing status and source metadata.
- [ ] Mapping suggestions remain visibly identified until reviewed.
- [ ] Validation separates blocking errors from warnings.
- [ ] Rules are summarised in plain language before processing.
- [ ] Results link to source values and applied match evidence.
- [ ] Resolution and approval actions create visible audit history.
- [ ] Processing and report states reflect backend-confirmed status, never fabricated progress.

### Accessibility and responsiveness

- [ ] All controls work with keyboard only.
- [ ] Focus order and focus restoration are predictable.
- [ ] Status and result categories do not rely on colour alone.
- [ ] The product remains usable at 200% zoom and reflows where required.
- [ ] Compact-screen users can complete the entire reconciliation workflow.
- [ ] Touch users receive all guidance provided to pointer-hover users.
- [ ] Reduced-motion and forced-colours preferences are respected.

---

## 18. UI questions requiring product and domain approval

These decisions should be resolved with a GST domain expert and the handling engineer before high-fidelity design approval because they change visible workflows, terminology, states, or controls:

1. Which GSTR-1 source formats and portal exports are officially supported?
2. Are B2B, B2C, credit/debit notes, exports, advances, amendments, and e-commerce supplies all included in the first release?
3. Which identifiers and amount fields are mandatory per document type?
4. What default invoice-number normalisation and monetary/date tolerances are acceptable?
5. Which resolution options have approved accounting and filing meanings?
6. Is a reviewer approval required, and which roles may reopen approved work?
7. Which retention, download, archive, and deletion actions must the interface expose, and to which roles?
8. Which accounting-platform or GST-service connections must appear as source options in the interface?
9. What file-size, row-count, and expected processing-time limits must the interface communicate?
10. Which report formats and audit fields are required by clients or regulators?
11. Is multilingual support required, and if so, which languages and tax terms need verified translations?
12. Should reconciliation include GSTR-1 versus GSTR-3B summary checks in addition to sales-register comparisons?

Until these questions are approved, the related screens are interaction proposals rather than claims of verified GST policy or implemented functionality.

---

## 19. Recommended UI design deliverables for the next phase

After domain decisions are recorded, the design validation and handoff phase should produce these artifacts in order:

1. Low-fidelity responsive flows for setup, results, exception resolution, and approval.
2. A token-based light and dark component library covering every state in this document.
3. High-fidelity desktop and compact-screen designs for the core journey.
4. A clickable prototype tested with finance executives and tax reviewers.
5. A content inventory and domain-approved GST glossary.
6. Accessibility review covering keyboard navigation, table semantics, tooltip parity, contrast, zoom, and reduced motion.
7. UI handoff with annotated layouts, component state matrices, interaction rules, and approved copy.

This specification defines the intended interface only. It does not claim that the software, GST logic, integrations, or compliance controls have been implemented or validated.
