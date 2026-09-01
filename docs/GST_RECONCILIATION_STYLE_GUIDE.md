# ReconSoft — UI Style Guide

## 1. Visual Direction

The interface should feel precise, calm, financial, and data-focused.

Use:

* Minimal decoration
* Flat solid surfaces
* Muted colours
* Clear typography
* Dense but readable tables
* One horizontal top navbar
* No sidebars
* No gradients

Colour is primarily functional. The accent should occupy a small portion of the interface.

---

## 2. Colour System

### Light Mode

| Token          | Value     |
| -------------- | --------- |
| Background     | `#F6F8F6` |
| Surface        | `#FFFFFF` |
| Surface Subtle | `#EFF2EF` |
| Border         | `#D5DCD7` |
| Border Strong  | `#89968E` |
| Text Primary   | `#19221C` |
| Text Secondary | `#526058` |
| Text Disabled  | `#7D8981` |
| Accent         | `#356A55` |
| Accent Hover   | `#2C5947` |
| Accent Subtle  | `#E4EFE9` |
| Focus          | `#426F86` |
| Info           | `#416B7B` |
| Success        | `#356B4E` |
| Warning        | `#80611F` |
| Danger         | `#9A4242` |

### Semantic Backgrounds

| State   | Background |
| ------- | ---------- |
| Info    | `#E7F0F3`  |
| Success | `#E6F1EA`  |
| Warning | `#F6EFD9`  |
| Danger  | `#F7E8E8`  |

Use amber or neutral treatment for ordinary reconciliation mismatches. Red is reserved for invalid data, failed operations, blocked actions, and destructive actions.

---

## 3. Dark Mode

| Token          | Value     |
| -------------- | --------- |
| Background     | `#111613` |
| Surface        | `#19201B` |
| Surface Subtle | `#222B25` |
| Border         | `#39463E` |
| Border Strong  | `#68796F` |
| Text Primary   | `#EEF3EF` |
| Text Secondary | `#B4BEB7` |
| Accent         | `#80B39A` |
| Accent Hover   | `#94C2AA` |
| Accent Subtle  | `#233B30` |
| Info           | `#88B7C8` |
| Success        | `#85B99A` |
| Warning        | `#D0AF65` |
| Danger         | `#E09595` |

The reference defines dark mode independently rather than as an inverted light theme.

---

## 4. Typography

Font stack:

`"Kind Sans", "Noto Sans", "Segoe UI", Roboto, Arial, sans-serif`

| Style         |    Size |  Weight |
| ------------- | ------: | ------: |
| Page title    | 24–28px | 600–650 |
| Section title | 18–22px |     600 |
| Body          |    14px |     400 |
| Label         |    13px |     600 |
| Table text    | 13–14px |     400 |
| Caption       |    12px |     400 |
| Metric        |    24px |     650 |

Use tabular numerals for monetary values, percentages, dates, counts, and identifiers.

Example:

`₹12,34,567.00`

---

## 5. Spacing and Shape

Use a 4px spacing grid:

`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40px`

Recommended:

* Page padding: `24–32px`
* Section gap: `24px`
* Card padding: `16–24px`
* Table cells: `10–12px`
* Control height: `40px`

Radius:

* Buttons and inputs: `6px`
* Cards and panels: `8px`
* Status pills: `999px`

Borders: `1px`

Use shadows only for menus, dialogs, and overlapping surfaces.

---

## 6. Top Navigation

Use a horizontal navbar only.

```text
ReconSoft   Home   Documents   Reconciliations

                                                  Organisation ▾   Search   User ▾
```

Style:

* Height: `56–64px`
* Background: `#FFFFFF`
* Bottom border: `#D5DCD7`
* Inactive text: `#526058`
* Active text: `#356A55`
* Active indicator: `#356A55`
* Hover background: `#EFF2EF`

Do not use a green-filled navbar.

---

## 7. Buttons

### Primary

```css
background: #356A55;
color: #FFFFFF;
border: 1px solid #356A55;
```

Hover: `#2C5947`

Use for one dominant action such as:

`Run reconciliation`

### Secondary

```css
background: #FFFFFF;
color: #19221C;
border: 1px solid #89968E;
```

### Destructive

Use `#9A4242`.

Solid red should normally appear only inside destructive confirmation states.

---

## 8. Inputs

Default:

```css
background: #FFFFFF;
border: 1px solid #89968E;
color: #19221C;
```

Focus:

* Border/ring: `#426F86`
* Visible `2px` focus indicator

Error:

* Border/text: `#9A4242`

Every field should have a visible label. Placeholder text is supplementary, not a replacement for the label.

---

## 9. Tables

Tables are the primary reconciliation surface.

Use:

* White table background
* `#FAFBFA` or `#EFF2EF` headers/hover states
* `#D5DCD7` row dividers
* Right-aligned financial values
* Tabular numerals
* Sticky headers
* Subtle row hover
* Minimal vertical borders

Example:

| Supplier    | Invoice  | Sales Register |  GSTR-1 | Difference | Status   |
| ----------- | -------- | -------------: | ------: | ---------: | -------- |
| ABC Traders | INV-1042 |        ₹18,500 | ₹18,500 |         ₹0 | Matched  |
| XYZ Ltd     | INV-2231 |        ₹42,000 | ₹39,500 |     ₹2,500 | Mismatch |

---

## 10. Status Treatment

| State                    | Colour  |
| ------------------------ | ------- |
| Matched                  | Success |
| Possible / Partial Match | Warning |
| Mismatch                 | Warning |
| Missing                  | Neutral |
| Processing               | Info    |
| Failed                   | Danger  |

Always combine colour with a text label and, where useful, an icon.

Do not communicate status using colour alone.

---

## 11. Cards and Metrics

Use cards only where content is independently meaningful.

```css
background: #FFFFFF;
border: 1px solid #D5DCD7;
border-radius: 8px;
```

Example:

**Matched**
`₹10,92,440`
`2,116 records`

Do not use large saturated coloured cards.

---

## 12. Icons and Motion

Use one outline icon family such as Lucide.

* Standard icon: `18–20px`
* Inline/help icon: `16px`
* Stroke: `1.5–2px`

Motion:

* `120–180ms`
* Use only for hover, focus, menu, dialog, or state transitions
* No decorative animation
* No glow
* No gradients

---

## 13. Core Tokens

```css
:root {
  --background: #F6F8F6;
  --surface: #FFFFFF;
  --surface-subtle: #EFF2EF;

  --border: #D5DCD7;
  --border-strong: #89968E;

  --text-primary: #19221C;
  --text-secondary: #526058;
  --text-disabled: #7D8981;

  --accent: #356A55;
  --accent-hover: #2C5947;
  --accent-subtle: #E4EFE9;

  --focus: #426F86;

  --info: #416B7B;
  --success: #356B4E;
  --warning: #80611F;
  --danger: #9A4242;

  --radius-control: 6px;
  --radius-panel: 8px;

  --font-ui: "Kind Sans", "Noto Sans", "Segoe UI", Roboto, Arial, sans-serif;
}
```

## Final Visual Principle

**muted green accent + warm neutral surfaces + restrained semantic colours + compact financial typography + horizontal navigation + dense structured data + minimal decoration.**
