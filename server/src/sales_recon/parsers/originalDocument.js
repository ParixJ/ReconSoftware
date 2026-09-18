import fs from "node:fs/promises";
import { parse as parseCsv } from "csv-parse/sync";
import { readSheet } from "read-excel-file/node";
import { detectFileType } from "./detectFileType.js";
import { parseUploadedFile } from "./index.js";

const SOURCE_PATH_FIELD = "Source path";

function populated(value) {
  return value !== null && value !== undefined && value !== "";
}

function uniqueHeaders(values = []) {
  const occurrences = new Map();
  return values.map((value, index) => {
    const base = String(value ?? "").trim() || `Column ${index + 1}`;
    const count = (occurrences.get(base) || 0) + 1;
    occurrences.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function rowsFromMatrix(matrix, headerRowNumber = 1) {
  if (!Array.isArray(matrix) || !matrix.length) return { fields: [], rows: [], headerRowNumber: 1 };
  const headerIndex = Math.max(0, Math.min(matrix.length - 1, Number(headerRowNumber || 1) - 1));
  const fields = uniqueHeaders(matrix[headerIndex]);
  const rows = matrix.slice(headerIndex + 1)
    .filter((cells) => Array.isArray(cells) && cells.some(populated))
    .map((cells) => Object.fromEntries(fields.map((field, index) => [field, cells[index] ?? ""])));
  return { fields, rows, headerRowNumber: headerIndex + 1 };
}

function fieldsFromRows(rows, preferred = []) {
  const fields = [];
  const seen = new Set();
  for (const field of preferred) {
    if (!seen.has(field)) {
      seen.add(field);
      fields.push(field);
    }
  }
  for (const row of rows) {
    for (const field of Object.keys(row || {})) {
      if (!seen.has(field)) {
        seen.add(field);
        fields.push(field);
      }
    }
  }
  return fields;
}

function joinFieldPath(prefix, key) {
  return prefix ? `${prefix}.${key}` : key;
}

function joinLocationPath(prefix, key) {
  return prefix === "$" ? `$.${key}` : `${prefix}.${key}`;
}

function walkJson(value, locationPath = "$", fieldPrefix = "", inherited = {}) {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => walkJson(entry, `${locationPath}[${index}]`, fieldPrefix, inherited));
  }
  if (!value || typeof value !== "object") {
    return [{ [SOURCE_PATH_FIELD]: locationPath, ...inherited, [fieldPrefix || "Value"]: value }];
  }

  const current = { ...inherited };
  const branches = [];
  for (const [key, child] of Object.entries(value)) {
    const childFieldPath = joinFieldPath(fieldPrefix, key);
    const childLocationPath = joinLocationPath(locationPath, key);
    if (child && typeof child === "object") branches.push({ child, childFieldPath, childLocationPath });
    else current[childFieldPath] = child;
  }

  const populatedBranches = branches.filter(({ child }) => !Array.isArray(child) || child.length > 0);
  if (!populatedBranches.length) return [{ [SOURCE_PATH_FIELD]: locationPath, ...current }];
  return populatedBranches.flatMap(({ child, childFieldPath, childLocationPath }) => (
    walkJson(child, childLocationPath, childFieldPath, current)
  ));
}

function rowsFromJson(payload) {
  const rows = walkJson(payload);
  return { fields: fieldsFromRows(rows, [SOURCE_PATH_FIELD]), rows, headerRowNumber: null };
}

function parsedPdfRows(parsed) {
  const excluded = new Set(["rows", "sourceFields", "sourceRows", "summary", "anomalies", "suggestedFieldMap", "payments"]);
  const common = Object.fromEntries(Object.entries(parsed)
    .filter(([key, value]) => !excluded.has(key) && (value === null || ["string", "number", "boolean"].includes(typeof value))));
  const rows = (parsed.rows || []).map((row) => ({ ...common, "Record group": "Return table", ...row }));
  for (const payment of parsed.payments || []) rows.push({ ...common, "Record group": "Tax payment", ...payment });
  if (!rows.length && Object.keys(common).length) rows.push(common);
  return { fields: fieldsFromRows(rows), rows, headerRowNumber: null };
}

async function parseJsonSource(filePath) {
  const payload = JSON.parse((await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
  return rowsFromJson(payload);
}

async function parseCsvSource(filePath) {
  const content = (await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
  const matrix = parseCsv(content, { skip_empty_lines: true, trim: true, relax_column_count: true, bom: true });
  return rowsFromMatrix(matrix, 1);
}

export async function extractOriginalDocument(filePath, originalName, mimeType, options = {}) {
  const fileType = options.fileType || await detectFileType(filePath, originalName, mimeType);
  if (fileType === "json") return { fileType, ...await parseJsonSource(filePath) };
  if (fileType === "csv") return { fileType, ...await parseCsvSource(filePath) };
  if (fileType === "xlsx") {
    let headerRowNumber = options.headerRowNumber;
    if (!headerRowNumber && !options.parsed) {
      const parsed = await parseUploadedFile(filePath, originalName, mimeType);
      headerRowNumber = parsed.headerRowNumber;
    }
    const matrix = await readSheet(filePath);
    return { fileType, ...rowsFromMatrix(matrix, headerRowNumber || options.parsed?.headerRowNumber || 1) };
  }

  const parsed = options.parsed || await parseUploadedFile(filePath, originalName, mimeType);
  return { fileType, ...parsedPdfRows(parsed) };
}

