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

function normalizeSinglePeriod(value) {
  const raw = cleanText(value).replace(/[^0-9]/g, "");
  if (/^(0[1-9]|1[0-2])\d{4}$/.test(raw)) return raw;
  if (/^\d{4}(0[1-9]|1[0-2])$/.test(raw)) return `${raw.slice(4)}${raw.slice(0, 4)}`;
  return null;
}

function periodIndex(period) {
  return Number(period.slice(2)) * 12 + Number(period.slice(0, 2)) - 1;
}

function periodFromIndex(index) {
  const month = (index % 12) + 1;
  const year = Math.floor(index / 12);
  return `${String(month).padStart(2, "0")}${year}`;
}

export function normalizePeriod(value) {
  const text = cleanText(value);
  if (!text) return null;
  const rangeParts = text.split(/\s*(?:-|to)\s*/i).filter(Boolean);
  if (rangeParts.length === 2) {
    const start = normalizeSinglePeriod(rangeParts[0]);
    const end = normalizeSinglePeriod(rangeParts[1]);
    if (start && end && periodIndex(start) <= periodIndex(end)) return `${start}-${end}`;
  }
  return normalizeSinglePeriod(text) || text;
}

export function returnPeriodRange(value) {
  const period = normalizePeriod(value);
  if (/^(0[1-9]|1[0-2])\d{4}$/.test(period || "")) return { start: period, end: period };
  const match = String(period || "").match(/^((?:0[1-9]|1[0-2])\d{4})-((?:0[1-9]|1[0-2])\d{4})$/);
  if (!match) return null;
  if (periodIndex(match[1]) > periodIndex(match[2])) return null;
  return { start: match[1], end: match[2] };
}

export function isValidReturnPeriod(value) {
  return Boolean(returnPeriodRange(value));
}

export function isSingleReturnPeriod(value) {
  const range = returnPeriodRange(value);
  return Boolean(range && range.start === range.end);
}

export function isReturnPeriodRange(value) {
  const range = returnPeriodRange(value);
  return Boolean(range && range.start !== range.end);
}

export function expandReturnPeriod(value) {
  const range = returnPeriodRange(value);
  if (!range) return [];
  const start = periodIndex(range.start);
  const end = periodIndex(range.end);
  if (end - start > 23) return [];
  return Array.from({ length: end - start + 1 }, (_, offset) => periodFromIndex(start + offset));
}

export function returnPeriodCovers(value, target) {
  const range = returnPeriodRange(value);
  const targetRange = returnPeriodRange(target);
  if (!range || !targetRange) return false;
  if (targetRange.start !== targetRange.end) return range.start === targetRange.start && range.end === targetRange.end;
  const targetIndex = periodIndex(targetRange.start);
  return targetIndex >= periodIndex(range.start) && targetIndex <= periodIndex(range.end);
}

export function returnPeriodSortKey(value) {
  const range = returnPeriodRange(value);
  return range ? `${range.start.slice(2)}${range.start.slice(0, 2)}${range.end.slice(2)}${range.end.slice(0, 2)}` : "999999999999";
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

const GSTR1_INTERSTATE_UNREGISTERED_SECTIONS = new Set(["5", "B2CL", "9A-B2CL"]);
const GSTR1_POS_BASED_UNREGISTERED_SECTIONS = new Set(["7", "B2CS", "10", "9B-CDNUR", "CDNUR"]);

function stateCode(value) {
  return cleanText(value).toUpperCase().match(/\d{2}/)?.[0] || null;
}

function contributesToGstr3bTable32(row) {
  if (row.documentType !== "gstr1" || row.category !== "taxableOutward") return false;
  const section = cleanText(row.section).toUpperCase();
  if (GSTR1_INTERSTATE_UNREGISTERED_SECTIONS.has(section)) return true;
  if (!GSTR1_POS_BASED_UNREGISTERED_SECTIONS.has(section)) return false;
  const placeOfSupplyState = stateCode(row.placeOfSupply);
  const clientState = stateCode(row.clientGstin);
  return Boolean(placeOfSupplyState && clientState && placeOfSupplyState !== clientState);
}

function summaryCategories(row) {
  const categories = [row.category, ...(Array.isArray(row.summaryCategories) ? row.summaryCategories : [])];
  if (contributesToGstr3bTable32(row)) categories.push("interStateUnregistered");
  return [...new Set(categories.filter(Boolean))];
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
    for (const category of summaryCategories(row)) {
      if (summary[category]) addMoney(summary[category], row);
    }
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
