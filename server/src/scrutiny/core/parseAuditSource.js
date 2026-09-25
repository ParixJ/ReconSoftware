import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { readSheet } from "read-excel-file/node";
import { config } from "../../config.js";
import { normalizeAmount, toPaise } from "./money.js";
import { isMultiLedgerWorkbook, normalizeMultiLedgerWorkbook } from "./multiLedgerWorkbook.js";
import { isStockProductWorkbook, normalizeStockWorkbook } from "./stockWorkbook.js";
import { decodeJsonText, normalizeTallyJson, parseTallyJsonText } from "./tallyJson.js";
import { detectStructuredFormat, normalizeLedgerSections, readStructuredLedger,
  spreadsheetSheets } from "./structuredLedger.js";
import { isAuditQueryWorkbook, normalizeAuditQueryWorkbook } from "./queryWorkbook.js";

export const AUDIT_SOURCE_ROLES = Object.freeze([
  "books_vouchers", "books_ledgers", "trial_balance", "prior_year_trial_balance", "ais", "supporting_document",
]);

const REQUIRED = {
  books_vouchers: ["voucherId", "ledger", "side", "amount"],
  books_ledgers: ["ledger"],
  trial_balance: ["ledger", "openingDebit", "openingCredit", "closingDebit", "closingCredit"],
  prior_year_trial_balance: ["ledger", "openingDebit", "openingCredit", "closingDebit", "closingCredit"],
  ais: ["taxpayerId", "category", "period", "reference", "amount"],
};

const MONEY_FIELDS = new Set([
  "amount", "incomeAmount", "taxableValue", "openingBalance", "debits", "credits", "closingBalance",
  "openingDebit", "openingCredit", "closingDebit", "closingCredit",
]);

const ROLE_FIELDS = {
  books_vouchers: ["voucherId", "ledger", "side", "amount", "date", "voucherType", "counterparty", "narration", "incomeAmount", "incomeCategory", "taxableValue", "taxpayerId", "period", "reference"],
  books_ledgers: ["ledger", "openingBalance", "debits", "credits", "closingBalance"],
  trial_balance: ["ledger", "openingDebit", "openingCredit", "closingDebit", "closingCredit"],
  prior_year_trial_balance: ["ledger", "openingDebit", "openingCredit", "closingDebit", "closingCredit"],
  ais: ["taxpayerId", "category", "period", "reference", "amount", "date"],
};

const ALIASES = {
  voucherId: ["voucherid", "voucherno", "vouchernumber"],
  ledger: ["ledger", "ledgername", "ledgeraccount", "account", "accountname", "accounthead", "partyname"],
  side: ["side", "debitcredit", "drcr"],
  amount: ["amount", "transactionamount"],
  incomeAmount: ["incomeamount", "comparableincomeamount"],
  taxableValue: ["taxablevalue", "outwardtaxablevalue"],
  incomeCategory: ["incomecategory", "aiscategory"],
  category: ["category", "informationcategory"],
  taxpayerId: ["taxpayerid", "pan"],
  period: ["period", "reportingperiod"],
  reference: ["reference", "transactionreference", "documentreference"],
  date: ["date", "voucherdate", "transactiondate"],
  voucherType: ["vouchertype", "transactiontype"],
  counterparty: ["counterparty", "party", "particulars"],
  narration: ["narration", "description"],
  openingBalance: ["openingbalance", "openingbal", "opbalance"],
  debits: ["debits", "debit", "dr", "dramount", "debitamount", "debitmovement", "perioddebits"],
  credits: ["credits", "credit", "cr", "cramount", "creditamount", "creditmovement", "periodcredits"],
  closingBalance: ["closingbalance", "closingbal", "clbalance"],
  openingDebit: ["openingdebit", "openingdr"],
  openingCredit: ["openingcredit", "openingcr"],
  closingDebit: ["closingdebit", "closingdr"],
  closingCredit: ["closingcredit", "closingcr"],
};

function keyOf(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const canonicalField = new Map(Object.entries(ALIASES).flatMap(([name, aliases]) =>
  aliases.map((alias) => [alias, name])));

function fieldIndex(row, profile) {
  const index = new Map();
  for (const [name, value] of Object.entries(row)) {
    const canonical = canonicalField.get(keyOf(name));
    if (canonical && !index.has(canonical)) index.set(canonical, value);
  }
  for (const [field, column] of Object.entries(profile?.fields || {})) {
    if (!ROLE_FIELDS[profile.role]?.includes(field)) continue;
    if (Object.hasOwn(row, column)) index.set(field, row[column]);
  }
  return index;
}

function populated(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function text(value) {
  return String(value ?? "").trim();
}

function tableRows(matrix) {
  const nonempty = matrix.findIndex((row) => Array.isArray(row) && row.some(populated));
  if (nonempty < 0) return [];
  const headers = matrix[nonempty].map(text);
  if (headers.some((header) => !header) || new Set(headers.map(keyOf)).size !== headers.length) {
    throw new Error("The table header must contain unique, nonempty column names.");
  }
  return matrix.slice(nonempty + 1).flatMap((cells, index) =>
    !Array.isArray(cells) || !cells.some(populated) ? [] : [{
      row: Object.fromEntries(headers.map((header, column) => [header, cells[column] ?? ""])),
      rowNumber: nonempty + index + 2,
    }]);
}

function jsonRows(payload, role) {
  const root = Array.isArray(payload) ? { records: payload } : payload;
  if (!root || typeof root !== "object") throw new Error("Expected an array or a JSON object containing records.");
  const collection = root.records ?? root[role] ?? (
    role === "books_vouchers" ? root.vouchers : role === "books_ledgers" ? root.ledgers :
      role === "ais" ? root.transactions : root.trialBalance
  );
  if (!Array.isArray(collection)) throw new Error("Expected a records array for the selected source role.");
  const rows = [];
  for (let index = 0; index < collection.length; index += 1) {
    const row = collection[index];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      rows.push({ row: {}, rowNumber: index + 1 });
      continue;
    }
    if (role === "books_vouchers" && Array.isArray(row.postings)) {
      if (!row.postings.length) rows.push({ row: {}, rowNumber: index + 1 });
      // A voucher-level income total must not be copied onto every posting.
      const voucherContext = { ...row };
      delete voucherContext.incomeAmount;
      delete voucherContext.taxableValue;
      for (let postingIndex = 0; postingIndex < row.postings.length; postingIndex += 1) {
        const posting = row.postings[postingIndex];
        rows.push({
          row: { ...voucherContext, ...(posting && typeof posting === "object" ? posting : {}), postings: undefined },
          rowNumber: index + 1,
          postingNumber: postingIndex + 1,
        });
      }
    } else rows.push({ row, rowNumber: index + 1 });
  }
  return { rows, metadata: { financialYear: root.financialYear ?? root.fiscalYear,
    taxpayerId: root.taxpayerId, completeExport: root.completeExport } };
}

function normalizeRow(input, role, metadata, provenance, profile) {
  const output = { provenance };
  const fields = fieldIndex(input, profile);
  for (const name of ROLE_FIELDS[role]) {
    const value = fields.get(name);
    if (populated(value)) output[name] = MONEY_FIELDS.has(name) ? normalizeAmount(value) : text(value);
  }
  if (!output.taxpayerId && metadata.taxpayerId) output.taxpayerId = metadata.taxpayerId;
  for (const name of REQUIRED[role]) {
    if (!populated(output[name])) throw new Error(`Missing required field ${name}.`);
  }
  if (role === "books_vouchers") {
    const side = output.side.toLowerCase();
    if (side === "debit" || side === "dr") output.side = "debit";
    else if (side === "credit" || side === "cr") output.side = "credit";
    else throw new Error("Voucher side must be debit or credit.");
    if (toPaise(output.amount) < 0n) throw new Error("Voucher side carries the sign; amount must be nonnegative.");
    if (output.incomeAmount !== undefined && (!output.incomeCategory || !output.period || !output.reference || !(output.taxpayerId || metadata.taxpayerId))) {
      throw new Error("Comparable income requires taxpayerId, incomeCategory, period, and reference.");
    }
  }
  if (role === "books_ledgers" && [output.debits, output.credits]
    .filter(populated).some((value) => toPaise(value) < 0n)) {
    throw new Error("Ledger movement amounts must be nonnegative.");
  }
  if ((role === "trial_balance" || role === "prior_year_trial_balance") &&
    ["openingDebit", "openingCredit", "closingDebit", "closingCredit"].some((name) => toPaise(output[name]) < 0n)) {
    throw new Error("Trial-balance debit and credit columns must be nonnegative.");
  }
  if (role === "ais") output.category = output.category.toUpperCase();
  if (output.incomeCategory) output.incomeCategory = output.incomeCategory.toUpperCase();
  if (output.taxpayerId || metadata.taxpayerId) output.taxpayerId = (output.taxpayerId || metadata.taxpayerId).toUpperCase();
  if (output.ledger && profile?.accountRoles) {
    output.accountRole = profile.accountRoles[output.ledger] ??
      profile.accountRoles[output.ledger.toUpperCase()] ?? null;
  }
  return output;
}

export function normalizeAuditRows({ rows, role, sourceId, originalName, financialYear, taxpayerId,
  completeExport = true, format = "json", profile = null, rawRows = null, extractionIssues = [] }) {
  if (!AUDIT_SOURCE_ROLES.includes(role)) throw new TypeError(`Unsupported audit source role: ${role}`);
  const metadata = { financialYear: text(financialYear), taxpayerId: text(taxpayerId).toUpperCase() };
  const issues = [...extractionIssues];
  const records = [];
  let invalidCount = 0;
  let mappingFailures = 0;
  for (const item of rows) {
    const provenance = { sourceId, originalName, rowNumber: item.rowNumber };
    if (item.sheetName) provenance.sheetName = item.sheetName;
    if (item.postingNumber) provenance.postingNumber = item.postingNumber;
    try {
      records.push(normalizeRow(item.row, role, metadata, provenance, profile));
    } catch (error) {
      invalidCount += 1;
      const mappingMissing = /^Missing required field /.test(error.message);
      if (mappingMissing) mappingFailures += 1;
      if (issues.length < 100) issues.push({ code: mappingMissing ? "AUDIT_MAPPING_REQUIRED" : "INVALID_AUDIT_ROW",
        rowNumber: item.rowNumber, message: error.message });
    }
  }
  if (invalidCount > 100) issues.push({ code: "AUDIT_ROW_ISSUES_TRUNCATED",
    message: `${invalidCount} rows failed normalization; the first 100 row issues are shown.` });
  if (!rows.length) issues.push({ code: "EMPTY_AUDIT_SOURCE", message: "No data rows were found." });
  if (completeExport !== true) issues.push({ code: "AUDIT_EXPORT_COMPLETENESS_UNCONFIRMED",
    message: "Export completeness has not been confirmed; a clean comparison would be misleading." });
  return {
    sourceId, role, originalName, format, financialYear: metadata.financialYear || null,
    taxpayerId: metadata.taxpayerId || null, completeExport: completeExport === true,
    status: mappingFailures === rows.length && rows.length ? "review" : issues.length ? "insufficient_data" : "ready",
    recordCount: records.length, records,
    rawRows: rawRows || rows.map((item) => ({ ...item.raw ?? item.row, provenance: {
      sourceId, originalName, rowNumber: item.rowNumber, ...(item.sheetName ? { sheetName: item.sheetName } : {}) } })),
    issues,
  };
}

function failedSource({ sourceId, role, originalName, format, code, message }) {
  return { sourceId, role, originalName, format, financialYear: null, taxpayerId: null, completeExport: false,
    status: "insufficient_data", recordCount: 0, records: [], issues: [{ code, message }] };
}

function limitedSource(parsed) {
  const counts = [
    ["records", parsed.records?.length || 0, config.maxAuditRecords],
    ["raw rows", parsed.rawRows?.length || 0, config.maxAuditRawRows],
    ["text lines", parsed.textLines?.length || 0, config.maxAuditTextLines],
  ];
  const exceeded = counts.find(([, count, limit]) => count > limit);
  if (!exceeded) return parsed;
  const [label, count, limit] = exceeded;
  return failedSource({
    sourceId: parsed.sourceId,
    role: parsed.role,
    originalName: parsed.originalName,
    format: parsed.format,
    code: "AUDIT_SOURCE_LIMIT_EXCEEDED",
    message: `The audit source contains ${count} ${label}, above the configured limit of ${limit}.`,
  });
}

function applyAccountRoles(parsed, profile) {
  if (!profile?.accountRoles) return parsed;
  for (const record of parsed.records || []) {
    if (record.ledger) record.accountRole = profile.accountRoles[record.ledger] ??
      profile.accountRoles[record.ledger.toUpperCase()] ?? null;
  }
  return parsed;
}

export async function parseAuditSource({ filePath, originalName, role, sourceId, financialYear, fiscalYear,
  taxpayerId, completeExport, profile = null }) {
  if (!AUDIT_SOURCE_ROLES.includes(role)) throw new TypeError(`Unsupported audit source role: ${role}`);
  const extension = path.extname(originalName || "").toLowerCase().slice(1);
  if (!["json", "csv", "xlsx", "xls", "xml", "pdf"].includes(extension)) return failedSource({
    sourceId, role, originalName, format: extension, code: "UNSUPPORTED_AUDIT_FORMAT",
    message: "Audit data must be JSON, CSV, XLSX, XLS, XML, or PDF.",
  });
  const format = detectStructuredFormat(await fs.readFile(filePath));
  if (format === "pdf" && !["ais", "supporting_document"].includes(role)) return failedSource({
    sourceId, role, originalName, format, code: "UNSUPPORTED_AUDIT_FORMAT",
    message: "PDF requires the AIS or supporting-document source role.",
  });
  if (role === "supporting_document" && ["json", "csv", "xml"].includes(format)) return failedSource({
    sourceId, role, originalName, format, code: "UNSUPPORTED_AUDIT_FORMAT",
    message: "Supporting documents currently require PDF or an XLSX product-ledger workbook.",
  });
  let rows;
  let rawRows;
  let embeddedMetadata = {};
  try {
    if (format === "pdf") {
      if (role === "supporting_document") {
        const { parseSupportingPdf } = await import("./supportingPdf.js");
        return limitedSource(await parseSupportingPdf({ filePath, sourceId, originalName, completeExport: completeExport ?? false }));
      }
      const { parseAisPdf } = await import("./aisPdf.js");
      return limitedSource(await parseAisPdf({ filePath, sourceId, originalName,
        completeExport: completeExport ?? false, financialYear: financialYear ?? fiscalYear }));
    }
    if (format === "xml") {
      if (!["books_vouchers", "books_ledgers"].includes(role)) return failedSource({ sourceId, role,
        originalName, format, code: "AUDIT_SOURCE_ROLE_MISMATCH", message: "Tally XML requires a books role." });
      const structured = await readStructuredLedger({ filePath, profile });
      if (structured.metadata.shape === "tally_vouchers" && role === "books_ledgers") {
        return limitedSource(normalizeLedgerSections({ rows: structured.rows.map((item) => ({ ...item,
          row: { ...item.row, debit: item.row.side === "debit" ? item.row.amount : "",
            credit: item.row.side === "credit" ? item.row.amount : "" } })),
          sourceId, originalName, format, financialYear: financialYear ?? fiscalYear,
          taxpayerId, completeExport, accountRoles: profile?.accountRoles }));
      }
      rows = structured.rows;
      rawRows = structured.rawRows;
      embeddedMetadata = structured.metadata;
    } else if (format === "json") {
      const jsonText = decodeJsonText(await fs.readFile(filePath));
      if (/"mlvbody"\s*:/.test(jsonText.slice(0, 1000))) {
        if (!["books_vouchers", "books_ledgers"].includes(role)) return failedSource({
          sourceId, role, originalName, format, code: "AUDIT_SOURCE_ROLE_MISMATCH",
          message: "This Tally multi-ledger JSON should be uploaded as books vouchers or books ledgers.",
        });
        const { data, warnings } = parseTallyJsonText(jsonText);
        return limitedSource(applyAccountRoles(normalizeTallyJson({ data, warnings, role, sourceId, originalName,
          completeExport: completeExport ?? false, financialYear: financialYear ?? fiscalYear,
          normalizeRows: normalizeAuditRows }), profile));
      }
      const payload = JSON.parse(jsonText);
      const parsed = profile?.recordsPath ? await readStructuredLedger({ filePath, profile }) : jsonRows(payload, role);
      rows = parsed.rows;
      rawRows = parsed.rawRows;
      embeddedMetadata = parsed.metadata;
    } else if (format === "csv") {
      if (profile || role === "books_ledgers") {
        const structured = await readStructuredLedger({ filePath, profile });
        rows = structured.rows;
        rawRows = structured.rawRows;
        embeddedMetadata = structured.metadata;
      } else rows = tableRows(parseCsv((await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, ""), {
          skip_empty_lines: true, bom: true, relax_column_count: false,
        }));
    } else {
      const sheets = spreadsheetSheets(await fs.readFile(filePath));
      // Existing stock/account-statement dialects rely on typed cell values
      // from read-excel-file; the generic reader handles all other layouts.
      const sheet = format === "xlsx" ? await readSheet(filePath) : sheets[0]?.matrix || [];
      if (isStockProductWorkbook(sheet)) {
        if (role !== "supporting_document") return failedSource({ sourceId, role, originalName, format,
          code: "AUDIT_SOURCE_ROLE_MISMATCH", message: "This product ledger should be uploaded as a supporting document." });
        return limitedSource(normalizeStockWorkbook({ rows: sheet, sourceId, originalName,
          completeExport: completeExport ?? false }));
      }
      if (role === "supporting_document" && isAuditQueryWorkbook(sheets)) {
        return limitedSource(normalizeAuditQueryWorkbook({ matrix: sheet, sheets, sourceId, originalName,
          completeExport: completeExport ?? false, format, financialYear: financialYear ?? fiscalYear }));
      }
      if (isMultiLedgerWorkbook(sheet)) {
        if (role !== "books_ledgers") return failedSource({
          sourceId, role, originalName, format, code: "AUDIT_SOURCE_ROLE_MISMATCH",
          message: "This multi-ledger workbook should be uploaded as books ledgers.",
        });
        return limitedSource(applyAccountRoles(normalizeMultiLedgerWorkbook({ rows: sheet, sourceId, originalName,
          completeExport: completeExport ?? false, fiscalYear: financialYear ?? fiscalYear,
          normalizeRows: normalizeAuditRows }), profile));
      }
      if (role === "supporting_document") return failedSource({ sourceId, role, originalName, format,
        code: "AUDIT_SUPPORT_DOCUMENT_UNKNOWN", message: "This spreadsheet is not a supported product-ledger layout." });
      const structured = await readStructuredLedger({ filePath, profile });
      if (structured.metadata.shape === "ledger_sections" && role === "books_ledgers") {
        return limitedSource(normalizeLedgerSections({ rows: structured.rows, rawRows: structured.rawRows,
          sourceId, originalName, format,
          financialYear: financialYear ?? fiscalYear, taxpayerId, completeExport,
          accountRoles: profile?.accountRoles,
          ledgerStatements: structured.metadata.ledgerStatements,
          extractionIssues: structured.metadata.extractionIssues }));
      }
      rows = structured.rows;
      rawRows = structured.rawRows;
      embeddedMetadata = structured.metadata;
    }
  } catch (error) {
    if (error?.code === "AUDIT_OCR_BUSY") throw error;
    if (error?.code && ["ENOENT", "EACCES", "EPERM"].includes(error.code)) throw error;
    const code = /AUDIT_SOURCE_LIMIT_EXCEEDED|too many|exceeds/i.test(error.message) ? "AUDIT_SOURCE_LIMIT_EXCEEDED" :
      /header.*unique|header row/i.test(error.message) ? "AUDIT_TABLE_HEADER_INVALID" :
      /record path|record array|mapping profile/i.test(error.message) ? "AUDIT_MAPPING_REQUIRED" :
      format === "xml" ? "AUDIT_XML_INVALID" : format === "json" ? "AUDIT_JSON_INVALID" :
      ["xls", "xlsx"].includes(format) ? "AUDIT_WORKBOOK_INVALID" :
      format === "csv" ? "AUDIT_CSV_INVALID" : "INVALID_AUDIT_SOURCE";
    return failedSource({ sourceId, role, originalName, format, code,
      message: code === "AUDIT_SOURCE_LIMIT_EXCEEDED"
        ? "The audit source exceeds configured parsing limits."
        : "The source could not be structured for the selected role; inspect its original rows and mapping profile." });
  }
  return limitedSource(normalizeAuditRows({ rows, role, sourceId, originalName, format,
    financialYear: embeddedMetadata.financialYear ?? financialYear ?? fiscalYear,
    taxpayerId: embeddedMetadata.taxpayerId ?? taxpayerId,
    completeExport: completeExport ?? embeddedMetadata.completeExport ?? false,
    profile: profile ? { ...profile, role } : null, rawRows,
    extractionIssues: embeddedMetadata.extractionIssues || [] }));
}
