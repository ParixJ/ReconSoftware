export const GSTIN_PATTERN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/i;

export function asNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? "").replace(/[₹,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : 0;
}

export function cleanText(value) {
  return String(value ?? "").trim();
}

export function normalizePeriod(value) {
  const raw = cleanText(value).replace(/[^0-9]/g, "");
  if (/^(0[1-9]|1[0-2])\d{4}$/.test(raw)) return raw;
  if (/^\d{4}(0[1-9]|1[0-2])$/.test(raw)) return `${raw.slice(4)}${raw.slice(0, 4)}`;
  return cleanText(value) || null;
}

export function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return `${String(value.getDate()).padStart(2, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${value.getFullYear()}`;
  }
  const raw = cleanText(value);
  const parts = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (parts) {
    const year = parts[3].length === 2 ? `20${parts[3]}` : parts[3];
    return `${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}-${year}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? raw : normalizeDate(parsed);
}

export function emptyMoney() {
  return { taxableValue: 0, invoiceValue: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, totalTax: 0 };
}

export function moneyFrom(source = {}, sign = 1) {
  const money = {
    taxableValue: sign * asNumber(source.taxableValue ?? source.txval ?? source.taxable_value),
    invoiceValue: sign * asNumber(source.invoiceValue ?? source.val ?? source.invoice_value),
    igst: sign * asNumber(source.igst ?? source.iamt ?? source.integratedTax),
    cgst: sign * asNumber(source.cgst ?? source.camt ?? source.centralTax),
    sgst: sign * asNumber(source.sgst ?? source.samt ?? source.stateTax),
    cess: sign * asNumber(source.cess ?? source.csamt),
  };
  money.totalTax = money.igst + money.cgst + money.sgst + money.cess;
  return money;
}

export function addMoney(target, source) {
  for (const key of ["taxableValue", "invoiceValue", "igst", "cgst", "sgst", "cess", "totalTax"]) {
    target[key] = asNumber(target[key]) + asNumber(source[key]);
  }
  return target;
}

export function summarizeRows(rows) {
  const summary = {
    taxableOutward: emptyMoney(),
    taxableOutwardBase: emptyMoney(),
    taxableOutwardAdjustments: emptyMoney(),
    zeroRated: emptyMoney(),
    nilExempt: emptyMoney(),
    nonGst: emptyMoney(),
    reverseCharge: emptyMoney(),
    itcAvailable: emptyMoney(),
    itcClaimed: emptyMoney(),
    interStateUnregistered: emptyMoney(),
  };
  for (const row of rows) {
    if (summary[row.category]) addMoney(summary[row.category], row);
    if (row.category === "taxableOutward" && row.liabilityComponent === "base") {
      addMoney(summary.taxableOutwardBase, row);
    } else if (row.category === "taxableOutward" && row.liabilityComponent === "adjustment") {
      addMoney(summary.taxableOutwardAdjustments, row);
    }
  }
  return summary;
}

export function firstGstin(value) {
  const match = cleanText(value).toUpperCase().match(GSTIN_PATTERN);
  return match?.[0] || null;
}

export function detectDocumentType({ filename = "", payload, text = "" }) {
  const name = filename.toLowerCase().replace(/[^a-z0-9]/g, "");
  const sample = Array.isArray(payload) ? payload[0] : payload;
  const root = sample?.data || sample || {};
  if (root.docdata && root.itcsumm) return "gstr2b";
  if (root.sup_details || root.sup_det || root.osup_det || root.itc_elg) return "gstr3b";
  if (root.b2b || root.b2cl || root.b2cs || root.exp || root.cdnr || root.hsn) return "gstr1";
  if (/gstr?3b|3breturn/.test(name) || /GSTR\s*-?\s*3B/i.test(text)) return "gstr3b";
  if (/gstr?2b|r2b/.test(name) || /GSTR\s*-?\s*2B/i.test(text)) return "gstr2b";
  if (/gstr?2/.test(name) || /GSTR\s*-?\s*2\b/i.test(text)) return "gstr2";
  if (/gstr?1/.test(name) || /GSTR\s*-?\s*1\b/i.test(text)) return "gstr1";
  return "unknown";
}

export function jsonSafeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
