import {
  GSTIN_PATTERN,
  addMoney,
  asNumber,
  cleanText,
  emptyMoney,
  firstGstin,
  normalizeDate,
  summarizeRows,
} from "./utils.js";

const MAX_HEADER_ROWS = 60;
const DATE_HEADERS = ["bill date", "invoice date", "document date", "voucher date", "date"];
const TAXABLE_HEADERS = ["assessable amount", "taxable value", "taxable amount", "net taxable value"];
const INVOICE_VALUE_HEADERS = ["bill amount", "invoice value", "invoice amount", "gross amount", "total amount"];
const INVOICE_NUMBER_HEADERS = ["bill no", "bill number", "invoice no", "invoice number", "document number", "voucher number"];
const PARTY_GSTIN_HEADERS = ["party gstin no", "party gstin", "recipient gstin", "gstin/uin of recipient", "customer gstin", "buyer gstin"];
const PARTY_NAME_HEADERS = ["party name", "customer name", "recipient name", "buyer name", "trade name"];
const TYPE_HEADERS = ["c/d", "debit/credit", "document type", "voucher type", "invoice type", "type"];

export class SalesRegisterParseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SalesRegisterParseError";
    this.code = code;
  }
}

function normalizedHeader(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, " ");
}

function exactColumn(headers, candidates) {
  return headers.findIndex((header) => candidates.includes(header));
}

function matchingColumns(headers, pattern) {
  return headers.flatMap((header, index) => pattern.test(header) ? [index] : []);
}

function findHeader(matrix) {
  for (let index = 0; index < Math.min(matrix.length, MAX_HEADER_ROWS); index += 1) {
    const headers = (matrix[index] || []).map(normalizedHeader);
    const date = exactColumn(headers, DATE_HEADERS);
    const taxable = exactColumn(headers, TAXABLE_HEADERS);
    const hasTaxableBreakup = headers.some((header) => /(?:assessable|taxable).*(?:amount|value)/i.test(header));
    if (date >= 0 && (taxable >= 0 || hasTaxableBreakup)) return { index, headers };
  }
  return null;
}

function excelSerialDate(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return null;
  const milliseconds = Math.round((value - 25569) * 86400 * 1000);
  const date = new Date(milliseconds);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  const serial = excelSerialDate(value);
  if (serial) return serial;
  const raw = cleanText(value);
  const numeric = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (numeric) {
    const year = Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]);
    const date = new Date(year, Number(numeric[2]) - 1, Number(numeric[1]));
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function returnPeriod(date) {
  return `${String(date.getMonth() + 1).padStart(2, "0")}${date.getFullYear()}`;
}

function exactGstin(value) {
  const candidate = cleanText(value).toUpperCase();
  const pattern = new RegExp(`^${GSTIN_PATTERN.source.replace(/^\\b|\\b$/g, "")}$`, "i");
  return pattern.test(candidate) ? candidate : null;
}

function sumColumns(row, columns) {
  return columns.reduce((total, column) => total + asNumber(row[column]), 0);
}

function signed(value, isCredit) {
  const amount = asNumber(value);
  return isCredit && amount > 0 ? -amount : amount;
}

function round(value) {
  return Math.round((asNumber(value) + Number.EPSILON) * 100) / 100;
}

function roundMoney(money) {
  for (const key of ["taxableValue", "invoiceValue", "igst", "cgst", "sgst", "cess", "totalTax"]) {
    money[key] = round(money[key]);
  }
  return money;
}

function emptyPeriod() {
  return {
    recordCount: 0,
    b2bRecordCount: 0,
    b2cRecordCount: 0,
    adjustmentCount: 0,
    grossInvoiceValue: 0,
    nilExemptValue: 0,
    b2b: emptyMoney(),
    b2c: emptyMoney(),
    creditDebitNotes: emptyMoney(),
    net: emptyMoney(),
  };
}

function fieldConfiguration(headers) {
  const date = exactColumn(headers, DATE_HEADERS);
  const taxable = exactColumn(headers, TAXABLE_HEADERS);
  const invoiceValue = exactColumn(headers, INVOICE_VALUE_HEADERS);
  const invoiceNumber = exactColumn(headers, INVOICE_NUMBER_HEADERS);
  const counterpartyGstin = exactColumn(headers, PARTY_GSTIN_HEADERS);
  const tradeName = exactColumn(headers, PARTY_NAME_HEADERS);
  const documentKind = exactColumn(headers, TYPE_HEADERS);
  const taxableColumns = taxable >= 0 ? [taxable] : matchingColumns(
    headers,
    /(?:assessable|taxable).*(?:amount|value)/i,
  ).filter((index) => !/(?:nil|exempt|non[- ]?gst)/i.test(headers[index]));
  return {
    date,
    taxableColumns,
    invoiceValue,
    invoiceNumber,
    counterpartyGstin,
    tradeName,
    documentKind,
    cgstColumns: matchingColumns(headers, /(?:central\s+tax|\bcgst\b)/i),
    sgstColumns: matchingColumns(headers, /(?:state\s*\/\s*ut\s+tax|state\s+tax|\bsgst\b|\butgst\b)/i),
    igstColumns: matchingColumns(headers, /(?:integrated\s+tax|\bigst\b)/i),
    cessColumns: matchingColumns(headers, /\bcess\b/i),
    nilColumns: matchingColumns(headers, /(?:nil|exempt).*(?:assessable|taxable).*(?:amount|value)/i),
  };
}

function sourceObjects(matrix, headerIndex) {
  const fields = (matrix[headerIndex] || []).map((value, index) => cleanText(value) || `Column ${index + 1}`);
  const rows = matrix.slice(headerIndex + 1)
    .filter((row) => Array.isArray(row) && row.some((value) => value !== null && value !== undefined && value !== ""))
    .map((row) => Object.fromEntries(fields.map((field, index) => [field, row[index] ?? ""])));
  return { fields, rows };
}

function isSummaryRow(row) {
  return row.some((value) => /^(?:grand\s+total|sub\s*total|subtotal|total)$/i.test(cleanText(value)));
}

export function parseSalesRegisterMatrix(matrix, filename = "", options = {}) {
  const strict = options.strict !== false;
  if (!Array.isArray(matrix) || !matrix.length) {
    if (!strict) return null;
    throw new SalesRegisterParseError("EMPTY_SALES_REGISTER", "The sales register has no populated rows.");
  }
  const header = findHeader(matrix);
  if (!header) {
    if (!strict) return null;
    throw new SalesRegisterParseError(
      "SALES_REGISTER_HEADER_NOT_FOUND",
      "Could not locate the sales-register header. A bill/invoice date and taxable/assessable value column are required.",
    );
  }

  const fields = fieldConfiguration(header.headers);
  if (fields.date < 0 || !fields.taxableColumns.length) {
    throw new SalesRegisterParseError(
      "SALES_REGISTER_COLUMNS_MISSING",
      "The sales register must contain a bill/invoice date and taxable/assessable value column.",
    );
  }

  const rows = [];
  const periods = {};
  const duplicateKeys = new Set();
  let duplicateCount = 0;
  let ignoredDateCount = 0;
  let firstDate = null;
  let lastDate = null;

  for (let index = header.index + 1; index < matrix.length; index += 1) {
    const source = matrix[index] || [];
    if (!source.some((value) => value !== null && value !== undefined && value !== "")) continue;
    const date = parseDate(source[fields.date]);
    if (!date) {
      if (isSummaryRow(source)) continue;
      ignoredDateCount += 1;
      continue;
    }

    const period = returnPeriod(date);
    const documentKind = fields.documentKind >= 0 ? cleanText(source[fields.documentKind]) : "";
    const isCredit = /(?:credit|credit\s*note|^cr\.?$|^c$)/i.test(documentKind);
    const taxableValue = signed(sumColumns(source, fields.taxableColumns), isCredit);
    const invoiceValue = signed(fields.invoiceValue >= 0 ? source[fields.invoiceValue] : taxableValue, isCredit);
    const igst = signed(sumColumns(source, fields.igstColumns), isCredit);
    const cgst = signed(sumColumns(source, fields.cgstColumns), isCredit);
    const sgst = signed(sumColumns(source, fields.sgstColumns), isCredit);
    const cess = signed(sumColumns(source, fields.cessColumns), isCredit);
    const nilExemptValue = signed(sumColumns(source, fields.nilColumns), isCredit);
    const counterpartyGstin = fields.counterpartyGstin >= 0 ? exactGstin(source[fields.counterpartyGstin]) : null;
    const invoiceNumber = fields.invoiceNumber >= 0 ? cleanText(source[fields.invoiceNumber]) || null : null;
    const adjustment = isCredit || taxableValue < 0 || invoiceValue < 0;
    const bookCategory = counterpartyGstin ? "b2b" : "b2c";
    const money = roundMoney({
      taxableValue,
      invoiceValue,
      igst,
      cgst,
      sgst,
      cess,
      totalTax: igst + cgst + sgst + cess,
    });
    const row = {
      section: "books",
      category: "taxableOutward",
      bookCategory,
      documentType: "salesRegister",
      clientGstin: null,
      counterpartyGstin,
      tradeName: fields.tradeName >= 0 ? cleanText(source[fields.tradeName]) || null : null,
      invoiceNumber,
      invoiceDate: normalizeDate(date),
      returnPeriod: period,
      placeOfSupply: null,
      reverseCharge: null,
      documentKind: documentKind || null,
      isAdjustment: adjustment,
      sourceRowNumber: index + 1,
      nilExemptValue: round(nilExemptValue),
      ...money,
    };
    rows.push(row);

    const periodSummary = periods[period] || emptyPeriod();
    periodSummary.recordCount += 1;
    periodSummary.grossInvoiceValue += money.invoiceValue;
    periodSummary.nilExemptValue += row.nilExemptValue;
    if (bookCategory === "b2b") periodSummary.b2bRecordCount += 1;
    else periodSummary.b2cRecordCount += 1;
    addMoney(periodSummary[bookCategory], money);
    addMoney(periodSummary.net, money);
    if (adjustment) {
      periodSummary.adjustmentCount += 1;
      addMoney(periodSummary.creditDebitNotes, money);
    }
    periods[period] = periodSummary;

    if (!firstDate || date < firstDate) firstDate = date;
    if (!lastDate || date > lastDate) lastDate = date;
    if (invoiceNumber) {
      const duplicateKey = `${counterpartyGstin || cleanText(row.tradeName).toUpperCase()}|${invoiceNumber.toUpperCase()}|${period}`;
      if (duplicateKeys.has(duplicateKey)) duplicateCount += 1;
      else duplicateKeys.add(duplicateKey);
    }
  }

  for (const period of Object.values(periods)) {
    period.grossInvoiceValue = round(period.grossInvoiceValue);
    period.nilExemptValue = round(period.nilExemptValue);
    roundMoney(period.b2b);
    roundMoney(period.b2c);
    roundMoney(period.creditDebitNotes);
    roundMoney(period.net);
  }

  const preamble = JSON.stringify(matrix.slice(0, header.index));
  const gstin = firstGstin(`${filename} ${preamble}`);
  for (const row of rows) row.clientGstin = gstin;
  const anomalies = [];
  if (!gstin) anomalies.push({
    code: "BOOKS_GSTIN_NOT_FOUND",
    severity: "warning",
    message: "The taxpayer GSTIN was not found in the sales-register heading or filename.",
    suggestion: "Confirm that this register belongs to the GSTIN shown on the uploaded returns.",
  });
  if (!rows.length) anomalies.push({
    code: "NO_SALES_RECORDS",
    severity: "error",
    message: "No dated sales records were found below the detected header.",
    suggestion: "Verify the workbook sheet, header row and bill-date values.",
  });
  if (ignoredDateCount) anomalies.push({
    code: "BOOKS_ROWS_WITHOUT_VALID_DATE",
    severity: "warning",
    message: `${ignoredDateCount} populated row${ignoredDateCount === 1 ? " was" : "s were"} ignored because the bill/invoice date was invalid.`,
    suggestion: "Review totals, footer rows and malformed dates in the sales register.",
  });
  if (duplicateCount) anomalies.push({
    code: "DUPLICATE_BOOKS_INVOICE",
    severity: "warning",
    message: `${duplicateCount} possible duplicate invoice${duplicateCount === 1 ? " was" : "s were"} found for the same party and period.`,
    suggestion: "Review duplicate invoice numbers before finalizing the reconciliation.",
  });

  const source = sourceObjects(matrix, header.index);
  const periodKeys = Object.keys(periods).sort((a, b) => `${a.slice(2)}${a.slice(0, 2)}`.localeCompare(`${b.slice(2)}${b.slice(0, 2)}`));
  const summary = summarizeRows(rows);
  for (const value of Object.values(summary)) roundMoney(value);
  return {
    documentType: "salesRegister",
    gstin,
    returnPeriod: periodKeys.length === 1 ? periodKeys[0] : null,
    rows,
    summary,
    periods,
    sourceFields: source.fields,
    sourceRows: source.rows,
    builtInSchema: true,
    suggestedFieldMap: {
      invoiceDate: source.fields[fields.date] || "",
      invoiceNumber: fields.invoiceNumber >= 0 ? source.fields[fields.invoiceNumber] : "",
      counterpartyGstin: fields.counterpartyGstin >= 0 ? source.fields[fields.counterpartyGstin] : "",
      tradeName: fields.tradeName >= 0 ? source.fields[fields.tradeName] : "",
      taxableValue: source.fields[fields.taxableColumns[0]] || "",
      invoiceValue: fields.invoiceValue >= 0 ? source.fields[fields.invoiceValue] : "",
    },
    anomalies,
    headerRowNumber: header.index + 1,
    recordCount: rows.length,
    periodCount: periodKeys.length,
    dateRange: {
      from: firstDate ? normalizeDate(firstDate) : null,
      to: lastDate ? normalizeDate(lastDate) : null,
    },
  };
}
