// This catalog is deliberately section-scoped. A new PDF wording requires a new
// catalog version, rather than silently changing the meaning of older imports.
export const PDF_LABEL_ALIASES = Object.freeze({
  version: 2,
  form_26as: Object.freeze({
    document: [/Annual\s+Tax\s+Statement/i, /Form\s+26AS/i],
    section: [/PART[-\s]*I\s*[-–]?\s*Details\s+of\s+Tax\s+Deducted/i,
      /PART[-\s]*VI\s*[-–]?\s*Details\s+of\s+Tax\s+Collected/i],
    outOfScope: [/PART[-\s]*II\s*[-–]?\s*Details\s+of\s+Tax\s+Deducted\s+at\s+Source\s+for\s+15G\s*\/\s*15H/i],
    broadSection: /\b(?:PART[-\s]*(?:I|VI)|tax\s+(?:deducted|collected)\s+at\s+source)\b/i,
  }),
  tis: Object.freeze({
    document: [/Taxpayer\s+Information\s+Summary\s*\(TIS\)/i, /Taxpayer\s+Information\s+Summary/i],
    section: [/interest\s+(?:from\s+)?(?:term\s+)?deposit/i, /business\s+receipts/i,
      /gst\s+turnover/i, /gst\s+purchases|purchases\s+gst/i,
      /purchase\s+of\s+(?:time\s+)?deposits/i],
    broadSection: /\b(?:interest|business\s+receipts|gst|deposit)\b/i,
  }),
  tax_computation: Object.freeze({
    document: [/Computation\s+of\s+Total\s+Income/i, /Computation\s+of\s+Income/i],
    section: [/Income\s+from\s+Business/i, /Income\s+from\s+Other\s+Sources/i,
      /Gross\s+Total\s+Income/i, /Total\s+Income/i, /GST\s+Turnover\s+Detail/i],
    summaries: Object.freeze([
      ["income_business", /^Income from Business or Profession\b/i],
      ["income_other_sources", /^Income from Other Sources\b/i],
      ["gross_total_income", /^Gross Total Income$/i],
      ["total_income", /^Total Income$/i],
      ["tds_tcs_credit", /^T\.D\.S\.\s*\/\s*T\.C\.S\b/i],
      ["interest_savings", /^Interest From Saving Bank A\/c\b/i],
      ["interest_deposit", /^Interest on F\.D\.R\./i],
      ["interest_parties", /^Interest From Parties\b/i],
    ]),
    broadSection: /\b(?:income|turnover|tax\s+credit|refund)\b/i,
  }),
  gst_cash_ledger: Object.freeze({
    document: [/Electronic\s+Cash\s+Ledger/i],
    section: [/(Integrated|Central|State|CESS)\s+Tax\s+Amount\s+Debited/i],
    broadSection: /\b(?:tax\s+amount|amount\s+debited|opening\s+balance)\b/i,
  }),
  gst_credit_ledger: Object.freeze({
    document: [/Electronic\s+Credit\s+Ledger/i],
    section: [/Integrated\s+Central\s+State\s+CESS\s+Total/i,
      /Integrated\s+Tax.*Central\s+Tax.*State\s+Tax/i],
    broadSection: /\b(?:input\s+tax\s+credit|integrated|central|state|opening\s+balance)\b/i,
  }),
});

const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/gi;
const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/gi;

export function resolvePdfIdentity(lines, { kind = "pan", allowUnlabeled = false } = {}) {
  const candidates = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const text = String(line.text || "").toUpperCase();
    const labeledPan = /\b(?:PERMANENT\s+ACCOUNT\s+NUMBER|TAXPAYER\s+PAN|\bPAN\b)\s*(?:\(PAN\))?\s*(?:NO\.?|NUMBER)?\s*[:\-]?/i.test(text);
    const labeledGstin = /\b(?:TAXPAYER\s+GSTIN|\bGSTIN\b)\s*(?:NO\.?|NUMBER)?\s*[:\-]?/i.test(text);
    const location = line.provenance || { pageNumber: line.pageNumber, rowNumber: line.rowNumber };
    const next = lines[index + 1];
    const adjacent = next && (next.pageNumber ?? next.page ?? next.provenance?.pageNumber) ===
      (line.pageNumber ?? line.page ?? line.provenance?.pageNumber) ? String(next.text || "").toUpperCase() : "";
    const panMatches = [...text.matchAll(PAN)];
    const gstinMatches = [...text.matchAll(GSTIN)];
    if (labeledPan) for (const match of panMatches.length ? panMatches : adjacent.matchAll(PAN)) {
      candidates.push({ kind: "PAN", value: match[0], provenance: panMatches.length ? location :
        next.provenance || { pageNumber: next.pageNumber, rowNumber: next.rowNumber } });
    }
    if (labeledGstin) for (const match of gstinMatches.length ? gstinMatches : adjacent.matchAll(GSTIN)) {
      candidates.push({ kind: "GSTIN", value: match[0], provenance: gstinMatches.length ? location :
        next.provenance || { pageNumber: next.pageNumber, rowNumber: next.rowNumber } });
    }
    if (allowUnlabeled && !labeledPan) for (const match of panMatches) {
      candidates.push({ kind: "PAN", value: match[0], provenance: location });
    }
    if (allowUnlabeled && !labeledGstin) for (const match of gstinMatches) {
      candidates.push({ kind: "GSTIN", value: match[0], provenance: location });
    }
  }
  const pans = new Set(candidates.filter((item) => item.kind === "PAN").map((item) => item.value));
  const gstins = new Set(candidates.filter((item) => item.kind === "GSTIN").map((item) => item.value));
  for (const gstin of gstins) pans.add(gstin.slice(2, 12));
  const conflicting = pans.size > 1 || gstins.size > 1;
  const selected = !conflicting && (kind === "gstin" ? [...gstins][0] : [...pans][0]) || null;
  return { taxpayerId: selected, candidates, status: conflicting ? "review" : selected ? "ready" : "insufficient_data",
    issues: conflicting ? [{ code: "AUDIT_IDENTITY_CONFLICT", message: "The identity section contains conflicting PAN/GSTIN values." }] :
      selected ? [] : [{ code: "AUDIT_IDENTITY_NOT_FOUND", message: `No format-valid ${kind.toUpperCase()} was found in the identity section.` }] };
}

const MONTHS = new Map(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
  .map((name, index) => [name, index + 1]));

export function parseDocumentDate(value) {
  const text = String(value || "").trim();
  let match = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})$/.exec(text);
  if (!match) match = /^(\d{1,2})[\/-]([A-Za-z]{3})[\/-](20\d{2})$/.exec(text);
  if (!match) {
    const iso = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(text);
    if (iso) match = [text, iso[3], iso[2], iso[1]];
  }
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]) || MONTHS.get(match[2].toUpperCase());
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (!month || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return { day, month, year, financialYear: `${month >= 4 ? year : year - 1}-${month >= 4 ? year + 1 : year}` };
}

export function parseDocumentPeriod(value) {
  const match = /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-\s]*(20\d{2})$/i.exec(String(value || "").trim());
  if (!match) return null;
  const month = MONTHS.get(match[1].toUpperCase());
  const year = Number(match[2]);
  return { month, year, label: `${match[1].toUpperCase()}-${year}`,
    financialYear: `${month >= 4 ? year : year - 1}-${month >= 4 ? year + 1 : year}` };
}

export function quarterMatchesDate(value, date) {
  if (!value || !date) return false;
  const match = /Q([1-4])\s*(?:\(([^)]*)\))?/i.exec(String(value));
  if (!match) return false;
  const quarter = Math.floor(((date.month + 8) % 12) / 3) + 1;
  if (Number(match[1]) !== quarter) return false;
  const months = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*[-–]\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/i.exec(value);
  if (!months) return true;
  const start = MONTHS.get(months[1].toUpperCase());
  const end = MONTHS.get(months[2].toUpperCase());
  return start <= end ? date.month >= start && date.month <= end :
    date.month >= start || date.month <= end;
}

export function parsePrintedAmount(value, { integer = false } = {}) {
  const raw = String(value ?? "").trim().replace(/^₹\s*/, "");
  const negative = /^\(.+\)$/.test(raw) || raw.startsWith("-");
  const text = raw.replace(/^\((.*)\)$/, "$1").replace(/^-/, "");
  const plain = /^\d+(?:\.\d{1,2})?$/;
  const international = /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/;
  const indian = /^\d{1,3}(?:,\d{2})*,\d{3}(?:\.\d{1,2})?$/;
  if (![plain, international, indian].some((pattern) => pattern.test(text))) return null;
  if (integer && (text.includes(".") || negative)) return null;
  const normalized = text.replaceAll(",", "").replace(/^0+(?=\d)/, "");
  if (normalized.split(".")[0].length > 18) return null;
  return `${negative ? "-" : ""}${normalized}`;
}
