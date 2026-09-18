import { EXCEPTION_CODES } from "../../api/errorCodes.js";
import { auditNormalized } from "./anomalies.js";
import {
  asNumber,
  cleanText,
  emptyMoney,
  firstGstin,
  normalizePeriod,
  summarizeRows,
} from "./utils.js";

const MONTHS = new Map([
  ["jan", "01"], ["january", "01"],
  ["feb", "02"], ["february", "02"],
  ["mar", "03"], ["march", "03"],
  ["apr", "04"], ["april", "04"],
  ["may", "05"],
  ["jun", "06"], ["june", "06"],
  ["jul", "07"], ["july", "07"],
  ["aug", "08"], ["august", "08"],
  ["sep", "09"], ["sept", "09"], ["september", "09"],
  ["oct", "10"], ["october", "10"],
  ["nov", "11"], ["november", "11"],
  ["dec", "12"], ["december", "12"],
]);

const MONTH_PATTERN = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const AMOUNT_PATTERN = /\(?-?\d[\d,]*\.\d{1,2}\)?/g;

export function normalizePdfText(value) {
  return cleanText(value)
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\r?\n */g, "\n");
}

export function decimalAmounts(value) {
  return [...String(value || "").matchAll(AMOUNT_PATTERN)].map((match) => asNumber(match[0]));
}

export function sectionAfter(text, startPattern, endPattern, maxLength = 2500) {
  const start = text.match(startPattern);
  if (!start) return null;
  const startIndex = (start.index || 0) + start[0].length;
  const remainder = text.slice(startIndex, startIndex + maxLength);
  if (!endPattern) return remainder;
  const end = remainder.match(endPattern);
  return end ? remainder.slice(0, end.index) : remainder;
}

export function amountsAfter(text, startPattern, endPattern, maxLength = 1000) {
  const section = sectionAfter(text, startPattern, endPattern, maxLength);
  return section === null ? null : decimalAmounts(section);
}

function yearFromFinancialYear(month, firstYear, secondYear) {
  const monthNumber = Number(month);
  if (!monthNumber) return null;
  return monthNumber >= 4 ? firstYear : secondYear;
}

function monthNumber(name) {
  return MONTHS.get(String(name || "").toLowerCase());
}

function periodRange(startMonth, startYear, endMonth, endYear = startYear) {
  const resolvedEndYear = Number(endMonth) < Number(startMonth) && String(endYear) === String(startYear)
    ? Number(startYear) + 1
    : Number(endYear);
  return normalizePeriod(String(startMonth) + startYear + "-" + endMonth + resolvedEndYear);
}

export function periodFromText(text, filename = "") {
  const normalized = normalizePdfText(text);
  const numericRange = normalized.match(/(?:return|tax)\s*period\s*[:\-]?\s*((?:0[1-9]|1[0-2])\d{4})\s*(?:-|to)\s*((?:0[1-9]|1[0-2])\d{4})\b/i);
  if (numericRange) return normalizePeriod(numericRange[1] + "-" + numericRange[2]);

  const numeric = normalized.match(/(?:return|tax)\s*period\s*[:\-]?\s*((?:0[1-9]|1[0-2])\d{4})\b/i);
  if (numeric) return normalizePeriod(numeric[1]);

  const namedRangeWithYear = normalized.match(new RegExp("(?:return\\s*period|tax\\s*period|period|financial\\s+year\\s*\\/\\s*tax\\s*period)[^A-Za-z0-9]{0,15}" + MONTH_PATTERN + "[^A-Za-z0-9]{0,20}(?:-|to)[^A-Za-z0-9]{0,20}" + MONTH_PATTERN + "[^0-9]{0,15}(20\\d{2})", "i"));
  if (namedRangeWithYear) return periodRange(monthNumber(namedRangeWithYear[1]), namedRangeWithYear[3], monthNumber(namedRangeWithYear[2]));

  const namedWithYear = normalized.match(new RegExp("(?:return\\s*period|tax\\s*period|period|financial\\s+year\\s*\\/\\s*tax\\s*period)[^A-Za-z0-9]{0,15}" + MONTH_PATTERN + "[^0-9]{0,15}(20\\d{2})", "i"));
  if (namedWithYear) return MONTHS.get(namedWithYear[1].toLowerCase()) + namedWithYear[2];

  const namedRange = normalized.match(new RegExp("(?:return\\s*period|tax\\s*period|period)[^A-Za-z]{0,15}" + MONTH_PATTERN + "[^A-Za-z0-9]{0,20}(?:-|to)[^A-Za-z0-9]{0,20}" + MONTH_PATTERN, "i"));
  const financialYearForRange = normalized.match(/(?:financial\s+year|year)\s*(?:\/\s*tax\s*period)?\s*[:\-]?\s*(20\d{2})\s*-\s*(\d{2,4})/i);
  if (namedRange && financialYearForRange) {
    const startMonth = monthNumber(namedRange[1]);
    const endMonth = monthNumber(namedRange[2]);
    const secondYear = financialYearForRange[2].length === 2 ? financialYearForRange[1].slice(0, 2) + financialYearForRange[2] : financialYearForRange[2];
    return periodRange(
      startMonth,
      yearFromFinancialYear(startMonth, financialYearForRange[1], secondYear),
      endMonth,
      yearFromFinancialYear(endMonth, financialYearForRange[1], secondYear),
    );
  }

  const named = normalized.match(new RegExp("(?:return\\s*period|tax\\s*period|period)[^A-Za-z]{0,15}" + MONTH_PATTERN, "i"));
  const financialYear = normalized.match(/(?:financial\s+year|year)\s*(?:\/\s*tax\s*period)?\s*[:\-]?\s*(20\d{2})\s*-\s*(\d{2,4})/i);
  if (named && financialYear) {
    const month = MONTHS.get(named[1].toLowerCase());
    const secondYear = financialYear[2].length === 2 ? financialYear[1].slice(0, 2) + financialYear[2] : financialYear[2];
    return month + yearFromFinancialYear(month, financialYear[1], secondYear);
  }

  const sourceName = filename.replace(/\.[^.]+$/, "");
  const filenameRangeNamed = sourceName.match(new RegExp(MONTH_PATTERN + "[^A-Za-z0-9]{0,8}(?:-|to)[^A-Za-z0-9]{0,8}" + MONTH_PATTERN + "[^0-9]{0,8}(20\\d{2})", "i"));
  if (filenameRangeNamed) return periodRange(monthNumber(filenameRangeNamed[1]), filenameRangeNamed[3], monthNumber(filenameRangeNamed[2]));
  const filenameNamed = sourceName.match(new RegExp(MONTH_PATTERN + "[^0-9]{0,8}(20\\d{2})", "i"));
  if (filenameNamed) return MONTHS.get(filenameNamed[1].toLowerCase()) + filenameNamed[2];
  const filenameNumericRange = sourceName.match(/(?:^|[^0-9])((?:0[1-9]|1[0-2]))[^0-9]?(20\d{2})[^0-9]+((?:0[1-9]|1[0-2]))[^0-9]?(20\d{2})(?:[^0-9]|$)/);
  if (filenameNumericRange) return normalizePeriod(filenameNumericRange[1] + filenameNumericRange[2] + "-" + filenameNumericRange[3] + filenameNumericRange[4]);
  const filenameNumeric = sourceName.match(/(?:^|[^0-9])((?:0[1-9]|1[0-2]))[^0-9]?(20\d{2})(?:[^0-9]|$)/);
  return filenameNumeric ? filenameNumeric[1] + filenameNumeric[2] : null;
}

export function namedValue(text, labelPattern, endPattern) {
  const section = sectionAfter(text, labelPattern, endPattern, 500);
  if (section === null) return null;
  return cleanText(section.split(/\r?\n/).find(Boolean) || section).replace(/^[:\-]\s*/, "") || null;
}

export function moneyRow({ section, category, documentType, description, values, indexes = [0, 1, 2, 3, 4], extra = {} }) {
  const [taxableIndex, igstIndex, cgstIndex, sgstIndex, cessIndex] = indexes;
  const money = {
    ...emptyMoney(),
    taxableValue: asNumber(values?.[taxableIndex]),
    igst: asNumber(values?.[igstIndex]),
    cgst: asNumber(values?.[cgstIndex]),
    sgst: asNumber(values?.[sgstIndex]),
    cess: asNumber(values?.[cessIndex]),
  };
  money.totalTax = money.igst + money.cgst + money.sgst + money.cess;
  return {
    section,
    category,
    documentType,
    description,
    clientGstin: null,
    counterpartyGstin: null,
    tradeName: null,
    invoiceNumber: null,
    invoiceDate: null,
    placeOfSupply: null,
    reverseCharge: null,
    ...money,
    ...extra,
  };
}

export function finalizePdfParse({ documentType, text, filename, rows, anomalies = [], metadata = {}, extra = {} }) {
  const normalizedText = normalizePdfText(text);
  const gstin = firstGstin(normalizedText);
  const normalized = {
    documentType,
    gstin,
    returnPeriod: periodFromText(normalizedText, filename),
    rows: rows.map((row) => ({ ...row, clientGstin: row.clientGstin || gstin })),
    sourceFields: [],
    sourceRows: [],
    builtInSchema: true,
    anomalies,
    ...metadata,
    ...extra,
  };
  normalized.summary = summarizeRows(normalized.rows);
  normalized.anomalies = auditNormalized(normalized);
  return normalized;
}

export function scannedPdfAnomaly(text, documentType) {
  const normalized = normalizePdfText(text);
  if (new RegExp(`GSTR\\s*-?\\s*${documentType === "gstr3b" ? "3B" : "1"}`, "i").test(normalized)) return [];
  const letters = (normalized.match(/[A-Za-z]/g) || []).length;
  return letters >= 80 ? [] : [{
    code: EXCEPTION_CODES.SCANNED_PDF,
    severity: "error",
    message: `The ${documentType === "gstr3b" ? "GSTR-3B" : "GSTR-1"} PDF has no usable text layer and may be scanned.`,
    suggestion: "Run OCR first or upload the GST portal JSON/XLSX export.",
  }];
}
