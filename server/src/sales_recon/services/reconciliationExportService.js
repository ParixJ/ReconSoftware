import { ERROR_CODES } from "../../api/errorCodes.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { AppError } from "../../errors.js";
import { addMoney, asNumber, emptyMoney, expandReturnPeriod, GSTIN_PATTERN, isReturnPeriodRange, returnPeriodCovers } from "../parsers/utils.js";
import { rowsForReconciliation } from "./documentService.js";
import { listReconciliations } from "./reconciliationService.js";

/**
 * Generates the reconciliation workbook from the same period comparison snapshots that
 * power the UI. The template itself is fiscal-month based, so multi-month returns are
 * projected into month rows for export while the saved reconciliation result remains
 * period-based.
 */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.resolve(moduleDir, "../../../templates/GST_Reconciliation.xlsx");
const MONTHS = [
  ["04", "April"], ["05", "May"], ["06", "June"], ["07", "July"],
  ["08", "August"], ["09", "September"], ["10", "October"], ["11", "November"],
  ["12", "December"], ["01", "January"], ["02", "February"], ["03", "March"],
];
const MONEY_FIELDS = ["taxableValue", "invoiceValue", "igst", "cgst", "sgst", "cess", "totalTax"];
const GSTR1_NOTE_SECTIONS = new Set(["9", "9B-CDNR", "9B-CDNUR", "CDNR", "CDNUR"]);
const GSTR1_B2B_SECTIONS = new Set(["B2B", "4A", "4B", "6C", "9A-B2B", "9A-B2B-RCM"]);
const GSTR1_B2C_SECTIONS = new Set(["B2CL", "B2CS", "5", "7", "9A-B2CL", "10"]);
const EXPORT_SHEETS = Object.freeze([
  {
    key: "taxableValue",
    label: "Taxable Value",
    lastColumn: 14,
    columns: [
      ["gstr1B2b", "GSTR-1 B2B taxable value", "gstr1", "GSTR-1"],
      ["gstr1B2c", "GSTR-1 B2C taxable value", "gstr1", "GSTR-1"],
      ["gstr1CreditDebitNotes", "GSTR-1 credit/debit notes", "gstr1", "GSTR-1"],
      ["gstr1TotalTaxable", "GSTR-1 total taxable value", "gstr1", "GSTR-1"],
      ["gstr3bTaxable", "GSTR-3B taxable value", "gstr3b", "GSTR-3B"],
      ["gstr3bTaxableForComparison", "GSTR-3B taxable value for comparison", "gstr3b", "GSTR-3B"],
      ["booksB2b", "Books B2B taxable value", "salesRegister", "Sales register"],
      ["booksB2c", "Books B2C taxable value", "salesRegister", "Sales register"],
      ["booksCreditDebitNotes", "Books credit/debit notes", "salesRegister", "Sales register"],
      ["booksTotalTaxable", "Books total taxable value", "salesRegister", "Sales register"],
      ["booksB2bIncludingGst", "Books B2B including GST", "salesRegister", "Sales register"],
      ["gstr1VsGstr3bDifference", "Difference: GSTR-1 vs GSTR-3B", "comparison", "Comparison"],
      ["booksVsGstr3bDifference", "Difference: Books vs GSTR-3B", "comparison", "Comparison"],
    ],
  },
  {
    key: "outputTax",
    label: "Output Tax",
    lastColumn: 15,
    columns: [
      ["gstr1Igst", "GSTR-1 IGST", "gstr1", "GSTR-1"],
      ["gstr1Cgst", "GSTR-1 CGST", "gstr1", "GSTR-1"],
      ["gstr1Sgst", "GSTR-1 SGST", "gstr1", "GSTR-1"],
      ["gstr1TotalOutputTax", "GSTR-1 total output tax", "gstr1", "GSTR-1"],
      ["gstr3bIgst", "GSTR-3B IGST", "gstr3b", "GSTR-3B"],
      ["gstr3bCgst", "GSTR-3B CGST", "gstr3b", "GSTR-3B"],
      ["gstr3bSgst", "GSTR-3B SGST", "gstr3b", "GSTR-3B"],
      ["gstr3bTotalOutputTax", "GSTR-3B total output tax", "gstr3b", "GSTR-3B"],
      ["booksIgst", "Books IGST", "salesRegister", "Sales register"],
      ["booksCgst", "Books CGST", "salesRegister", "Sales register"],
      ["booksSgst", "Books SGST", "salesRegister", "Sales register"],
      ["booksTotalOutputTax", "Books total output tax", "salesRegister", "Sales register"],
      ["gstr1VsGstr3bTaxDifference", "Difference: GSTR-1 vs GSTR-3B tax", "comparison", "Comparison"],
      ["booksVsGstr3bTaxDifference", "Difference: Books vs GSTR-3B tax", "comparison", "Comparison"],
    ],
  },
]);

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

function clientGstinForPeriod(reconciliation, periodResult) {
  const gstins = [...new Set((periodResult.documents || [])
    .filter((document) => ["gstr1", "gstr3b"].includes(document.documentType))
    .map((document) => normalizeGstin(document.gstin))
    .filter(Boolean))];
  if (gstins.length === 1) return gstins[0];
  if (gstins.length > 1) return null;
  return normalizeGstin(periodResult.clientGstin || reconciliation.result?.clientGstin) || null;
}

function periodResultsFor(reconciliation) {
  const result = reconciliation?.result || {};
  if (Array.isArray(result.periods) && result.periods.length) return result.periods;
  return result.returnPeriod ? [result] : [];
}

function fiscalPeriods(fiscalYear) {
  const match = String(fiscalYear || "").trim().match(/^(\d{4})-(\d{4})$/);
  if (!match) {
    throw new AppError(400, ERROR_CODES.INVALID_EXPORT_FISCAL_YEAR, "Enter fiscal year in YYYY-YYYY format.");
  }
  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  if (endYear !== startYear + 1) {
    throw new AppError(400, ERROR_CODES.INVALID_EXPORT_FISCAL_YEAR, "Fiscal year must cover consecutive years.");
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

function resolveExportScope(input) {
  const fiscalYear = String(input.fiscalYear || "").trim();
  const year = String(input.year || "").trim();
  if (fiscalYear) return { ...fiscalPeriods(fiscalYear), fiscalYear };
  if (!/^\d{4}$/.test(year)) throw new AppError(400, ERROR_CODES.INVALID_EXPORT_YEAR, "Choose a four-digit reconciliation year to export.");
  return { ...calendarYearPeriods(year), year };
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

async function latestPeriodRows(userId, clientGstin, returnPeriods) {
  const reconciliations = await listReconciliations(userId);
  const requestedPeriods = new Set(returnPeriods);
  const selectedRows = new Map();
  const documentCache = new Map();

  for (const reconciliation of reconciliations) {
    for (const periodResult of periodResultsFor(reconciliation)) {
      const returnPeriod = periodResult.returnPeriod;
      const coveredPeriods = expandReturnPeriod(returnPeriod).filter((period) => requestedPeriods.has(period) && !selectedRows.has(period));
      if (!coveredPeriods.length) continue;
      if (clientGstinForPeriod(reconciliation, periodResult) !== clientGstin) continue;

      const periodDocumentIds = [...new Set((periodResult.documents || []).map((document) => document.id).filter(Boolean))];
      if (!periodDocumentIds.length) {
        for (const period of coveredPeriods) selectedRows.set(period, snapshotExportRow(periodResult));
        continue;
      }
      const cacheKey = periodDocumentIds.sort().join(":");
      if (!documentCache.has(cacheKey)) {
        documentCache.set(cacheKey, rowsForReconciliation(userId, periodDocumentIds));
      }
      try {
        const documents = await documentCache.get(cacheKey);
        for (const period of coveredPeriods) selectedRows.set(period, exportRow(period, documents, periodResult));
      } catch (error) {
        if (error.code === ERROR_CODES.DATABASE_WRITE_BUSY) throw error;
        for (const period of coveredPeriods) selectedRows.set(period, snapshotExportRow(periodResult));
      }
    }
  }
  return selectedRows;
}

function gstr1Values(documents, books) {
  if (documents.length !== 1) return { b2b: 0, b2c: 0, creditDebitNotes: 0, final: emptyMoney() };
  const document = documents[0];
  if (isReturnPeriodRange(document.returnPeriod) && books) {
    return {
      b2b: books.b2b,
      b2c: books.b2c,
      creditDebitNotes: books.creditDebitNotes,
      final: books.final,
    };
  }
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

function gstr3bValues(documents, books) {
  if (documents.length !== 1) return roundedMoney();
  return isReturnPeriodRange(documents[0].returnPeriod) && books
    ? books.final
    : roundedMoney(documents[0].parsed.summary?.taxableOutward);
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

function comparisonDifference(periodResult, table, measure, sourceLabel, filedLabel, sign = 1) {
  const comparison = snapshotComparison(periodResult, table, measure, sourceLabel, filedLabel);
  return comparison ? round(asNumber(comparison.difference) * sign) : null;
}

function taxComparisonDifference(periodResult, table, sourceLabel, filedLabel, sign = 1) {
  const values = ["igst", "cgst", "sgst"].map((measure) => comparisonDifference(periodResult, table, measure, sourceLabel, filedLabel, sign));
  return values.every((value) => value !== null) ? round(values.reduce((sum, value) => sum + value, 0)) : null;
}

function comparisonValueForExport(periodResult, comparisonValue, fallback) {
  if (comparisonValue === null || comparisonValue === undefined) return fallback;
  if (isReturnPeriodRange(periodResult?.returnPeriod) && comparisonValue !== 0) return fallback;
  return comparisonValue;
}

function applyComparisonDifferences(row, periodResult) {
  if (!periodResult) return row;
  const gstr1Vs3bTaxable = comparisonDifference(periodResult, "3.1(a)", "taxableValue", "GSTR-1", "GSTR-3B");
  const gstr3bVsBooksTaxable = comparisonDifference(periodResult, "Books to GSTR-3B", "taxableValue", "Sales register", "GSTR-3B", -1);
  const gstr1Vs3bTax = taxComparisonDifference(periodResult, "3.1(a)", "GSTR-1", "GSTR-3B");
  const gstr3bVsBooksTax = taxComparisonDifference(periodResult, "Books to GSTR-3B", "Sales register", "GSTR-3B", -1);

  row.taxableValue[11] = comparisonValueForExport(periodResult, gstr1Vs3bTaxable, row.taxableValue[11]);
  row.taxableValue[12] = comparisonValueForExport(periodResult, gstr3bVsBooksTaxable, row.taxableValue[12]);
  row.outputTax[12] = comparisonValueForExport(periodResult, gstr1Vs3bTax, row.outputTax[12]);
  row.outputTax[13] = comparisonValueForExport(periodResult, gstr3bVsBooksTax, row.outputTax[13]);
  return row;
}

function exportRow(returnPeriod, documents = [], periodResult = null) {
  const books = booksValues(documents.filter((document) => document.documentType === "salesRegister"), returnPeriod);
  const gstr1 = gstr1Values(documents.filter((document) => document.documentType === "gstr1" && returnPeriodCovers(document.returnPeriod, returnPeriod)), books);
  const gstr3b = gstr3bValues(documents.filter((document) => document.documentType === "gstr3b" && returnPeriodCovers(document.returnPeriod, returnPeriod)), books);
  const gstr1Tax = taxTotal(gstr1.final);
  const gstr3bTax = taxTotal(gstr3b);
  const booksTax = taxTotal(books.final);
  return applyComparisonDifferences({
    taxableValue: [
      gstr1.b2b, gstr1.b2c, gstr1.creditDebitNotes, gstr1.final.taxableValue,
      gstr3b.taxableValue, gstr3b.taxableValue,
      books.b2b, books.b2c, books.creditDebitNotes, books.final.taxableValue,
      books.b2bIncludingGst, round(gstr1.final.taxableValue - gstr3b.taxableValue),
      round(gstr3b.taxableValue - books.final.taxableValue),
    ],
    outputTax: [
      gstr1.final.igst, gstr1.final.cgst, gstr1.final.sgst, gstr1Tax,
      gstr3b.igst, gstr3b.cgst, gstr3b.sgst, gstr3bTax,
      books.final.igst, books.final.cgst, books.final.sgst, booksTax,
      round(gstr1Tax - gstr3bTax), round(gstr3bTax - booksTax),
    ],
  }, periodResult);
}

function snapshotComparison(periodResult, table, measure, sourceLabel, filedLabel) {
  return (periodResult.comparisons || []).find((item) => (
    item.table === table
    && item.measure === measure
    && (!sourceLabel || item.sourceLabel === sourceLabel)
    && (!filedLabel || item.filedLabel === filedLabel)
  ));
}

function snapshotMoney(periodResult, definitions) {
  const money = emptyMoney();
  for (const measure of ["taxableValue", "igst", "cgst", "sgst", "cess"]) {
    for (const definition of definitions) {
      const comparison = snapshotComparison(periodResult, definition.table, measure, definition.sourceLabel, definition.filedLabel);
      if (comparison) {
        money[measure] = asNumber(comparison[definition.side]);
        break;
      }
    }
  }
  money.totalTax = taxTotal(money);
  return roundedMoney(money);
}

function snapshotExportRow(periodResult) {
  const gstr1 = snapshotMoney(periodResult, [
    { table: "3.1(a)", side: "sourceValue", sourceLabel: "GSTR-1", filedLabel: "GSTR-3B" },
    { table: "Books to GSTR-1", side: "filedValue", sourceLabel: "Sales register", filedLabel: "GSTR-1" },
  ]);
  const gstr3b = snapshotMoney(periodResult, [
    { table: "3.1(a)", side: "filedValue", sourceLabel: "GSTR-1", filedLabel: "GSTR-3B" },
    { table: "Books to GSTR-3B", side: "filedValue", sourceLabel: "Sales register", filedLabel: "GSTR-3B" },
  ]);
  const books = snapshotMoney(periodResult, [
    { table: "Books to GSTR-1", side: "sourceValue", sourceLabel: "Sales register", filedLabel: "GSTR-1" },
    { table: "Books to GSTR-3B", side: "sourceValue", sourceLabel: "Sales register", filedLabel: "GSTR-3B" },
  ]);
  const gstr1Tax = taxTotal(gstr1);
  const gstr3bTax = taxTotal(gstr3b);
  const booksTax = taxTotal(books);
  return applyComparisonDifferences({
    taxableValue: [
      0, 0, 0, gstr1.taxableValue,
      gstr3b.taxableValue, gstr3b.taxableValue,
      0, 0, 0, books.taxableValue,
      0, round(gstr1.taxableValue - gstr3b.taxableValue),
      round(gstr3b.taxableValue - books.taxableValue),
    ],
    outputTax: [
      gstr1.igst, gstr1.cgst, gstr1.sgst, gstr1Tax,
      gstr3b.igst, gstr3b.cgst, gstr3b.sgst, gstr3bTax,
      books.igst, books.cgst, books.sgst, booksTax,
      round(gstr1Tax - gstr3bTax), round(gstr3bTax - booksTax),
    ],
  }, periodResult);
}

function exportCellId(returnPeriod, sheetKey, columnIndex) {
  return `${returnPeriod}:${sheetKey}:${columnIndex}`;
}

function exportDataRows(scope, rows) {
  return scope.periods.flatMap((returnPeriod, rowIndex) => EXPORT_SHEETS.flatMap((sheet) => (
    sheet.columns.map(([columnKey, field, documentType, documentTypeLabel], columnIndex) => ({
      id: exportCellId(returnPeriod, sheet.key, columnIndex),
      returnPeriod,
      templateTable: sheet.label,
      sheetKey: sheet.key,
      columnIndex,
      columnKey,
      field,
      documentType,
      documentTypeLabel,
      value: round(rows[rowIndex]?.[sheet.key]?.[columnIndex]),
    }))
  )));
}

function strictNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? "").replace(/[₹,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!normalized) return 0;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function applyExportAmendments(rows, scope, amendments) {
  if (!Array.isArray(amendments) || !amendments.length) return rows;
  const writableCells = new Map();
  scope.periods.forEach((returnPeriod, rowIndex) => {
    for (const sheet of EXPORT_SHEETS) {
      sheet.columns.forEach((_, columnIndex) => {
        writableCells.set(exportCellId(returnPeriod, sheet.key, columnIndex), { rowIndex, sheetKey: sheet.key, columnIndex });
      });
    }
  });

  for (const amendment of amendments) {
    const target = writableCells.get(String(amendment?.id || ""));
    if (!target) {
      throw new AppError(400, ERROR_CODES.INVALID_EXPORT_AMENDMENT, "One or more amended export cells do not belong to the selected export period.");
    }
    const value = strictNumber(amendment.value);
    if (value === null) {
      throw new AppError(400, ERROR_CODES.INVALID_EXPORT_AMENDMENT_VALUE, "Export amendment values must be numeric.");
    }
    rows[target.rowIndex][target.sheetKey][target.columnIndex] = round(value);
  }
  return rows;
}

async function buildExportRows(userId, clientGstin, scope) {
  const periodRows = await latestPeriodRows(userId, clientGstin, scope.periods);
  if (!periodRows.size) {
    throw new AppError(404, ERROR_CODES.RECONCILIATION_EXPORT_NOT_FOUND, `No reconciliations were found for ${clientGstin} in ${scope.label}.`);
  }
  return scope.periods.map((returnPeriod) => periodRows.get(returnPeriod) || exportRow(returnPeriod));
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
    if (!pattern.test(xml)) throw new AppError(500, ERROR_CODES.INVALID_RECONCILIATION_TEMPLATE, `The reconciliation template is missing cell ${cell}.`);
    xml = xml.replace(pattern, `$1${value}$2`);
  }
  return xml;
}

async function populateTemplate(rows) {
  let template;
  try {
    template = await fs.readFile(TEMPLATE_PATH);
  } catch {
    throw new AppError(500, ERROR_CODES.RECONCILIATION_TEMPLATE_MISSING, "The Excel reconciliation template is unavailable.");
  }
  const files = unzipSync(new Uint8Array(template));
  const taxablePath = "xl/worksheets/sheet1.xml";
  const outputTaxPath = "xl/worksheets/sheet2.xml";
  if (!files[taxablePath] || !files[outputTaxPath]) {
    throw new AppError(500, ERROR_CODES.INVALID_RECONCILIATION_TEMPLATE, "The Excel reconciliation template does not contain both required worksheets.");
  }
  for (const sheet of EXPORT_SHEETS) {
    const sheetPath = sheet.key === "taxableValue" ? taxablePath : outputTaxPath;
    files[sheetPath] = strToU8(replaceNumericCells(strFromU8(files[sheetPath]), rows.map((row) => row[sheet.key]), sheet.lastColumn));
  }
  return Buffer.from(zipSync(files, { level: 6 }));
}

export async function getReconciliationExportData(userId, input) {
  const clientGstin = exactGstin(input.clientGstin);
  const format = String(input.format || "excel").trim().toLowerCase();
  if (!clientGstin) throw new AppError(400, ERROR_CODES.INVALID_EXPORT_GSTIN, "Choose a valid client GSTIN to export.");
  if (format !== "excel") throw new AppError(400, ERROR_CODES.UNSUPPORTED_EXPORT_FORMAT, "Only Excel export is currently supported.");
  const scope = resolveExportScope(input);
  const rows = await buildExportRows(userId, clientGstin, scope);
  return {
    clientGstin,
    fiscalYear: scope.fiscalYear || null,
    year: scope.year || null,
    periodLabel: scope.label,
    format,
    rows: exportDataRows(scope, rows),
  };
}

export async function exportReconciliationWorkbook(userId, input) {
  const clientGstin = exactGstin(input.clientGstin);
  const format = String(input.format || "excel").trim().toLowerCase();
  if (!clientGstin) throw new AppError(400, ERROR_CODES.INVALID_EXPORT_GSTIN, "Choose a valid client GSTIN to export.");
  if (format !== "excel") throw new AppError(400, ERROR_CODES.UNSUPPORTED_EXPORT_FORMAT, "Only Excel export is currently supported.");
  const scope = resolveExportScope(input);
  const rows = applyExportAmendments(await buildExportRows(userId, clientGstin, scope), scope, input.rows);
  return {
    buffer: await populateTemplate(rows),
    filename: safeExportFilename(input.filename || input.documentName, clientGstin, scope.label),
  };
}
