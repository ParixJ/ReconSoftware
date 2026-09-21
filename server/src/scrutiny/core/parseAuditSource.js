import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { readSheet } from "read-excel-file/node";
import { normalizeAmount, toPaise } from "./money.js";

export const AUDIT_SOURCE_ROLES = Object.freeze([
  "books_vouchers", "books_ledgers", "trial_balance", "prior_year_trial_balance", "ais",
]);

const REQUIRED = {
  books_vouchers: ["voucherId", "ledger", "side", "amount"],
  books_ledgers: ["ledger", "openingBalance", "debits", "credits", "closingBalance"],
  trial_balance: ["ledger", "openingDebit", "openingCredit", "closingDebit", "closingCredit"],
  prior_year_trial_balance: ["ledger", "openingDebit", "openingCredit", "closingDebit", "closingCredit"],
  ais: ["taxpayerId", "category", "period", "reference", "amount"],
};

const MONEY_FIELDS = new Set([
  "amount", "incomeAmount", "openingBalance", "debits", "credits", "closingBalance",
  "openingDebit", "openingCredit", "closingDebit", "closingCredit",
]);

const ROLE_FIELDS = {
  books_vouchers: ["voucherId", "ledger", "side", "amount", "date", "incomeAmount", "incomeCategory", "taxpayerId", "period", "reference"],
  books_ledgers: ["ledger", "openingBalance", "debits", "credits", "closingBalance"],
  trial_balance: ["ledger", "openingDebit", "openingCredit", "closingDebit", "closingCredit"],
  prior_year_trial_balance: ["ledger", "openingDebit", "openingCredit", "closingDebit", "closingCredit"],
  ais: ["taxpayerId", "category", "period", "reference", "amount", "date"],
};

const ALIASES = {
  voucherId: ["voucherid", "voucherno", "vouchernumber"],
  ledger: ["ledger", "ledgername", "account", "accountname"],
  side: ["side", "debitcredit", "drcr"],
  amount: ["amount", "transactionamount"],
  incomeAmount: ["incomeamount", "comparableincomeamount"],
  incomeCategory: ["incomecategory", "aiscategory"],
  category: ["category", "informationcategory"],
  taxpayerId: ["taxpayerid", "pan"],
  period: ["period", "reportingperiod"],
  reference: ["reference", "transactionreference", "documentreference"],
  date: ["date", "voucherdate", "transactiondate"],
  openingBalance: ["openingbalance"],
  debits: ["debits", "debitmovement", "perioddebits"],
  credits: ["credits", "creditmovement", "periodcredits"],
  closingBalance: ["closingbalance"],
  openingDebit: ["openingdebit", "openingdr"],
  openingCredit: ["openingcredit", "openingcr"],
  closingDebit: ["closingdebit", "closingdr"],
  closingCredit: ["closingcredit", "closingcr"],
};

function keyOf(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function field(row, name) {
  const keys = ALIASES[name] || [keyOf(name)];
  const match = Object.keys(row).find((key) => keys.includes(keyOf(key)));
  return match === undefined ? undefined : row[match];
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
      for (let postingIndex = 0; postingIndex < row.postings.length; postingIndex += 1) {
        const posting = row.postings[postingIndex];
        rows.push({
          row: { ...row, ...(posting && typeof posting === "object" ? posting : {}), postings: undefined },
          rowNumber: index + 1,
          postingNumber: postingIndex + 1,
        });
      }
    } else rows.push({ row, rowNumber: index + 1 });
  }
  return { rows, metadata: { financialYear: root.financialYear ?? root.fiscalYear,
    taxpayerId: root.taxpayerId, completeExport: root.completeExport } };
}

function normalizeRow(input, role, metadata, provenance) {
  const output = { provenance };
  for (const name of ROLE_FIELDS[role]) {
    const value = field(input, name);
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
  if (role === "books_ledgers" && (toPaise(output.debits) < 0n || toPaise(output.credits) < 0n)) {
    throw new Error("Ledger movement amounts must be nonnegative.");
  }
  if ((role === "trial_balance" || role === "prior_year_trial_balance") &&
    ["openingDebit", "openingCredit", "closingDebit", "closingCredit"].some((name) => toPaise(output[name]) < 0n)) {
    throw new Error("Trial-balance debit and credit columns must be nonnegative.");
  }
  if (role === "ais") output.category = output.category.toUpperCase();
  if (output.incomeCategory) output.incomeCategory = output.incomeCategory.toUpperCase();
  if (output.taxpayerId || metadata.taxpayerId) output.taxpayerId = (output.taxpayerId || metadata.taxpayerId).toUpperCase();
  return output;
}

export function normalizeAuditRows({ rows, role, sourceId, originalName, financialYear, taxpayerId,
  completeExport = true, format = "json" }) {
  if (!AUDIT_SOURCE_ROLES.includes(role)) throw new TypeError(`Unsupported audit source role: ${role}`);
  const metadata = { financialYear: text(financialYear), taxpayerId: text(taxpayerId).toUpperCase() };
  const issues = [];
  const records = [];
  for (const item of rows) {
    const provenance = { sourceId, originalName, rowNumber: item.rowNumber };
    if (item.postingNumber) provenance.postingNumber = item.postingNumber;
    try {
      records.push(normalizeRow(item.row, role, metadata, provenance));
    } catch (error) {
      issues.push({ code: "INVALID_AUDIT_ROW", rowNumber: item.rowNumber, message: error.message });
    }
  }
  if (!rows.length) issues.push({ code: "EMPTY_AUDIT_SOURCE", message: "No data rows were found." });
  if (completeExport !== true) issues.push({ code: "AUDIT_EXPORT_COMPLETENESS_UNCONFIRMED",
    message: "Export completeness has not been confirmed; a clean comparison would be misleading." });
  return {
    sourceId, role, originalName, format, financialYear: metadata.financialYear || null,
    taxpayerId: metadata.taxpayerId || null, completeExport: completeExport === true,
    status: issues.length ? "insufficient_data" : "ready",
    recordCount: records.length, records, issues,
  };
}

function failedSource({ sourceId, role, originalName, format, code, message }) {
  return { sourceId, role, originalName, format, financialYear: null, taxpayerId: null, completeExport: false,
    status: "insufficient_data", recordCount: 0, records: [], issues: [{ code, message }] };
}

export async function parseAuditSource({ filePath, originalName, role, sourceId, financialYear, fiscalYear,
  taxpayerId, completeExport }) {
  if (!AUDIT_SOURCE_ROLES.includes(role)) throw new TypeError(`Unsupported audit source role: ${role}`);
  const format = path.extname(originalName || "").toLowerCase().slice(1);
  if (!["json", "csv", "xlsx"].includes(format)) return failedSource({
    sourceId, role, originalName, format, code: "UNSUPPORTED_AUDIT_FORMAT",
    message: "Audit data must be canonical JSON, CSV, or XLSX. PDF is evidence-only until a validated adapter exists.",
  });
  let rows;
  let embeddedMetadata = {};
  try {
    if (format === "json") {
      const payload = JSON.parse((await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
      const parsed = jsonRows(payload, role);
      rows = parsed.rows;
      embeddedMetadata = parsed.metadata;
    } else if (format === "csv") {
      rows = tableRows(parseCsv((await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, ""), {
        skip_empty_lines: true, bom: true, relax_column_count: false,
      }));
    } else rows = tableRows(await readSheet(filePath));
  } catch (error) {
    if (error?.code && ["ENOENT", "EACCES", "EPERM"].includes(error.code)) throw error;
    return failedSource({ sourceId, role, originalName, format, code: "INVALID_AUDIT_SOURCE",
      message: "The file could not be read as a canonical audit source for its assigned role." });
  }
  return normalizeAuditRows({ rows, role, sourceId, originalName, format,
    financialYear: financialYear ?? fiscalYear ?? embeddedMetadata.financialYear,
    taxpayerId: taxpayerId ?? embeddedMetadata.taxpayerId,
    completeExport: completeExport ?? embeddedMetadata.completeExport ?? false });
}
