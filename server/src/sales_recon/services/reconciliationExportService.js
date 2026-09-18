import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { AppError } from "../../errors.js";
import { addMoney, asNumber, emptyMoney, GSTIN_PATTERN } from "../parsers/utils.js";
import { rowsForReconciliation } from "./documentService.js";
import { listReconciliations } from "./reconciliationService.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.resolve(moduleDir, "../../../../sample-docs/GST_Reconciliation.xlsx");
const MONTHS = [
  ["04", "April"], ["05", "May"], ["06", "June"], ["07", "July"],
  ["08", "August"], ["09", "September"], ["10", "October"], ["11", "November"],
  ["12", "December"], ["01", "January"], ["02", "February"], ["03", "March"],
];
const MONEY_FIELDS = ["taxableValue", "invoiceValue", "igst", "cgst", "sgst", "cess", "totalTax"];
const GSTR1_NOTE_SECTIONS = new Set(["9", "9B-CDNR", "9B-CDNUR", "CDNR", "CDNUR"]);
const GSTR1_B2B_SECTIONS = new Set(["B2B", "4A", "4B", "6C", "9A-B2B", "9A-B2B-RCM"]);
const GSTR1_B2C_SECTIONS = new Set(["B2CL", "B2CS", "5", "7", "9A-B2CL", "10"]);

function round(value) {
  return Math.round((asNumber(value) + Number.EPSILON) * 100) / 100;
}

function roundedMoney(source = {}) {
  return Object.fromEntries(MONEY_FIELDS.map((field) => [field, round(source[field])]));
}

function taxTotal(money) {
  return round(asNumber(money.igst) + asNumber(money.cgst) + asNumber(money.sgst));
}

function normalizeGstin(value) {
  return String(value || "").trim().toUpperCase();
}

function exactGstin(value) {
  const normalized = normalizeGstin(value);
  const pattern = new RegExp(`^${GSTIN_PATTERN.source.replace(/^\\b|\\b$/g, "")}$`, "i");
  return pattern.test(normalized) ? normalized : null;
}

function clientGstinForPeriod(periodResult) {
  const gstins = [...new Set((periodResult.documents || [])
    .filter((document) => ["gstr1", "gstr3b"].includes(document.documentType))
    .map((document) => normalizeGstin(document.gstin))
    .filter(Boolean))];
  return gstins.length === 1 ? gstins[0] : null;
}

function fiscalPeriods(fiscalYear) {
  const match = String(fiscalYear || "").trim().match(/^(\d{4})-(\d{4})$/);
  if (!match) {
    throw new AppError(400, "INVALID_EXPORT_FISCAL_YEAR", "Enter fiscal year in YYYY-YYYY format.");
  }
  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  if (endYear !== startYear + 1) {
    throw new AppError(400, "INVALID_EXPORT_FISCAL_YEAR", "Fiscal year must cover consecutive years.");
  }
  return {
    label: `${startYear}-${endYear}`,
    periods: MONTHS.map(([month], index) => `${month}${index < 9 ? startYear : endYear}`),
  };
}

function calendarYearPeriods(year) {
  return {
    label: year,
    periods: MONTHS.map(([month]) => `${month}${year}`),
  };
}

function safeExportFilename(value, clientGstin, periodLabel) {
  const fallback = `GST_Reconciliation_${clientGstin}_${periodLabel}`;
  const base = String(value || fallback)
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 140) || fallback;
  return `${base}.xlsx`;
}

async function latestPeriodDocuments(userId, clientGstin, returnPeriods) {
  const reconciliations = await listReconciliations(userId);
  const requestedPeriods = new Set(returnPeriods);
  const selectedPeriods = new Map();
  const documentCache = new Map();

  for (const reconciliation of reconciliations) {
    for (const periodResult of reconciliation.result?.periods || []) {
      const returnPeriod = periodResult.returnPeriod;
      if (!requestedPeriods.has(returnPeriod) || selectedPeriods.has(returnPeriod)) continue;
      if (clientGstinForPeriod(periodResult) !== clientGstin) continue;

      const cacheKey = [...reconciliation.documentIds].sort().join(":");
      if (!documentCache.has(cacheKey)) {
        documentCache.set(cacheKey, rowsForReconciliation(userId, reconciliation.documentIds));
      }
      let documents;
      try {
        documents = await documentCache.get(cacheKey);
      } catch {
        throw new AppError(422, "RECONCILIATION_EXPORT_SOURCE_MISSING", `Source documents for ${returnPeriod} are unavailable. Upload or restore them before exporting.`);
      }
      const periodDocumentIds = new Set((periodResult.documents || []).map((document) => document.id));
      selectedPeriods.set(returnPeriod, documents.filter((document) => (
        periodDocumentIds.has(document.id) && normalizeGstin(document.gstin) === clientGstin
      )));
    }
  }
  return selectedPeriods;
}

function gstr1Values(documents) {
  if (documents.length !== 1) return { b2b: 0, b2c: 0, creditDebitNotes: 0, final: emptyMoney() };
  const document = documents[0];
  const b2b = emptyMoney();
  const b2c = emptyMoney();
  for (const row of document.parsed.rows || []) {
    if (row.category !== "taxableOutward") continue;
    const section = String(row.section || "").toUpperCase();
    if (GSTR1_NOTE_SECTIONS.has(section)) continue;
    if (GSTR1_B2B_SECTIONS.has(section) || (!GSTR1_B2C_SECTIONS.has(section) && row.counterpartyGstin)) addMoney(b2b, row);
    else addMoney(b2c, row);
  }
  const final = roundedMoney(document.parsed.summary?.taxableOutward);
  return {
    b2b: round(b2b.taxableValue),
    b2c: round(b2c.taxableValue),
    creditDebitNotes: round(b2b.taxableValue + b2c.taxableValue - final.taxableValue),
    final,
  };
}

function gstr3bValues(documents) {
  return documents.length === 1 ? roundedMoney(documents[0].parsed.summary?.taxableOutward) : roundedMoney();
}

function booksValues(documents, returnPeriod) {
  const b2b = emptyMoney();
  const b2c = emptyMoney();
  const final = emptyMoney();
  for (const document of documents) {
    const periodSummary = document.parsed.periods?.[returnPeriod];
    if (periodSummary) addMoney(final, periodSummary.net);
    else if (document.returnPeriod === returnPeriod) addMoney(final, document.parsed.summary?.taxableOutward);

    for (const row of document.parsed.rows || []) {
      if (row.returnPeriod !== returnPeriod || row.category !== "taxableOutward" || row.isAdjustment) continue;
      addMoney(row.bookCategory === "b2b" || row.counterpartyGstin ? b2b : b2c, row);
    }
  }
  const roundedFinal = roundedMoney(final);
  return {
    b2b: round(b2b.taxableValue),
    b2c: round(b2c.taxableValue),
    creditDebitNotes: round(b2b.taxableValue + b2c.taxableValue - roundedFinal.taxableValue),
    b2bIncludingGst: round(b2b.invoiceValue),
    final: roundedFinal,
  };
}

function exportRow(returnPeriod, documents = []) {
  const gstr1 = gstr1Values(documents.filter((document) => document.documentType === "gstr1" && document.returnPeriod === returnPeriod));
  const gstr3b = gstr3bValues(documents.filter((document) => document.documentType === "gstr3b" && document.returnPeriod === returnPeriod));
  const books = booksValues(documents.filter((document) => document.documentType === "salesRegister"), returnPeriod);
  const gstr1Tax = taxTotal(gstr1.final);
  const gstr3bTax = taxTotal(gstr3b);
  const booksTax = taxTotal(books.final);
  return {
    taxableValue: [
      gstr1.b2b, gstr1.b2c, gstr1.creditDebitNotes, gstr1.final.taxableValue,
      gstr3b.taxableValue, gstr3b.taxableValue,
      books.b2b, books.b2c, books.creditDebitNotes, books.final.taxableValue,
      books.b2bIncludingGst, round(gstr1.final.taxableValue - gstr3b.taxableValue),
      round(books.final.taxableValue - gstr3b.taxableValue),
    ],
    outputTax: [
      gstr1.final.igst, gstr1.final.cgst, gstr1.final.sgst, gstr1Tax,
      gstr3b.igst, gstr3b.cgst, gstr3b.sgst, gstr3bTax,
      books.final.igst, books.final.cgst, books.final.sgst, booksTax,
      round(gstr1Tax - gstr3bTax), round(booksTax - gstr3bTax),
    ],
  };
}

function columnName(index) {
  let value = index;
  let name = "";
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function replaceNumericCells(xml, rowValues, lastColumn) {
  const values = new Map();
  rowValues.forEach((row, rowIndex) => {
    row.forEach((value, valueIndex) => values.set(`${columnName(valueIndex + 2)}${rowIndex + 3}`, round(value)));
  });
  const totals = [];
  for (let column = 2; column <= lastColumn; column += 1) {
    totals.push(round(rowValues.reduce((sum, row) => sum + asNumber(row[column - 2]), 0)));
  }
  totals.forEach((value, index) => values.set(`${columnName(index + 2)}15`, value));

  for (const [cell, value] of values) {
    const pattern = new RegExp(`(<c\\s+r="${cell}"[^>]*>\\s*<v>)[^<]*(<\\/v>\\s*<\\/c>)`);
    if (!pattern.test(xml)) throw new AppError(500, "INVALID_RECONCILIATION_TEMPLATE", `The reconciliation template is missing cell ${cell}.`);
    xml = xml.replace(pattern, `$1${value}$2`);
  }
  return xml;
}

async function populateTemplate(rows) {
  let template;
  try {
    template = await fs.readFile(TEMPLATE_PATH);
  } catch {
    throw new AppError(500, "RECONCILIATION_TEMPLATE_MISSING", "The Excel reconciliation template is unavailable.");
  }
  const files = unzipSync(new Uint8Array(template));
  const taxablePath = "xl/worksheets/sheet1.xml";
  const outputTaxPath = "xl/worksheets/sheet2.xml";
  if (!files[taxablePath] || !files[outputTaxPath]) {
    throw new AppError(500, "INVALID_RECONCILIATION_TEMPLATE", "The Excel reconciliation template does not contain both required worksheets.");
  }
  files[taxablePath] = strToU8(replaceNumericCells(strFromU8(files[taxablePath]), rows.map((row) => row.taxableValue), 14));
  files[outputTaxPath] = strToU8(replaceNumericCells(strFromU8(files[outputTaxPath]), rows.map((row) => row.outputTax), 15));
  return Buffer.from(zipSync(files, { level: 6 }));
}

export async function exportReconciliationWorkbook(userId, input) {
  const clientGstin = exactGstin(input.clientGstin);
  const format = String(input.format || "excel").trim().toLowerCase();
  const fiscalYear = String(input.fiscalYear || "").trim();
  const year = String(input.year || "").trim();
  if (!clientGstin) throw new AppError(400, "INVALID_EXPORT_GSTIN", "Choose a valid client GSTIN to export.");
  if (format !== "excel") throw new AppError(400, "UNSUPPORTED_EXPORT_FORMAT", "Only Excel export is currently supported.");

  let scope;
  if (fiscalYear) {
    scope = fiscalPeriods(fiscalYear);
  } else {
    if (!/^\d{4}$/.test(year)) throw new AppError(400, "INVALID_EXPORT_YEAR", "Choose a four-digit reconciliation year to export.");
    scope = calendarYearPeriods(year);
  }

  const periodDocuments = await latestPeriodDocuments(userId, clientGstin, scope.periods);
  if (!periodDocuments.size) {
    throw new AppError(404, "RECONCILIATION_EXPORT_NOT_FOUND", `No reconciliations were found for ${clientGstin} in ${scope.label}.`);
  }
  const rows = scope.periods.map((returnPeriod) => exportRow(returnPeriod, periodDocuments.get(returnPeriod)));
  return {
    buffer: await populateTemplate(rows),
    filename: safeExportFilename(input.filename || input.documentName, clientGstin, scope.label),
  };
}
