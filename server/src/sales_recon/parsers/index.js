import fs from "node:fs/promises";
import pdf from "pdf-parse/lib/pdf-parse.js";
import { readSheet } from "read-excel-file/node";
import { parse as parseCsv } from "csv-parse/sync";
import { AppError } from "../../errors.js";
import { detectFileType } from "./detectFileType.js";
import { detectDocumentType, firstGstin, normalizePeriod } from "./utils.js";
import { genericNormalize, normalizeJson } from "./normalizers.js";
import { parseGstr1Text } from "./gstr1.js";
import { parseGstr3bText } from "./gstr3b.js";
import { parseSalesRegisterMatrix } from "./salesRegister.js";

async function parseJson(filePath, filename) {
  let payload;
  try {
    payload = JSON.parse((await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    throw new AppError(400, "INVALID_JSON", `${filename} is not valid JSON.`);
  }
  return normalizeJson(payload, filename);
}

async function parseWorkbook(filePath, filename) {
  let matrix;
  try {
    matrix = await readSheet(filePath);
  } catch {
    throw new AppError(400, "INVALID_WORKBOOK", `${filename} could not be read as an XLSX workbook.`);
  }
  if (!matrix.length) return genericNormalize([], filename, { anomalies: [{ code: "EMPTY_WORKBOOK", severity: "warning", message: "The workbook has no populated rows.", suggestion: "Upload a populated GST return export." }] });
  const salesRegister = parseSalesRegisterMatrix(matrix, filename, { strict: false });
  if (salesRegister) return salesRegister;
  const headers = matrix[0].map((value, index) => String(value ?? "").trim() || `Column ${index + 1}`);
  const rows = matrix.slice(1).filter((cells) => cells.some((value) => value !== null && value !== "")).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])),
  );
  return genericNormalize(rows, filename);
}

async function parseDelimited(filePath, filename) {
  const content = (await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
  let rows;
  try {
    rows = parseCsv(content, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true, bom: true });
  } catch {
    throw new AppError(400, "INVALID_CSV", `${filename} could not be read as a CSV table.`);
  }
  return genericNormalize(rows, filename);
}

async function parsePdf(filePath, filename) {
  let extracted;
  try {
    extracted = await pdf(await fs.readFile(filePath));
  } catch {
    throw new AppError(400, "INVALID_PDF", `${filename} could not be parsed as a PDF document.`);
  }
  const text = extracted.text || "";
  const documentType = detectDocumentType({ filename, text });
  if (documentType === "gstr1") return parseGstr1Text(text, filename);
  if (documentType === "gstr3b") return parseGstr3bText(text, filename);
  const lineRows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => ({ extractedText: line }));
  const periodMatch = text.match(/(?:return\s*period|tax\s*period)\s*[:\-]?\s*((?:0[1-9]|1[0-2])\d{4})/i);
  return genericNormalize(lineRows, filename, {
    text,
    documentType,
    gstin: firstGstin(text),
    returnPeriod: normalizePeriod(periodMatch?.[1]),
    anomalies: text.trim() ? [{
      code: "PDF_REVIEW_REQUIRED",
      severity: "warning",
      message: "PDF text was extracted, but table layout should be reviewed before reconciliation.",
      suggestion: "Open the document table and use Modify mapping if fields were not recognized.",
    }] : [{
      code: "SCANNED_PDF",
      severity: "error",
      message: "The PDF contains no extractable text and may be scanned.",
      suggestion: "Upload a text PDF or the GST portal JSON/XLSX export.",
    }],
  });
}

export async function parseUploadedFile(filePath, originalName, mimeType) {
  const fileType = await detectFileType(filePath, originalName, mimeType);
  const parsed = fileType === "json" ? await parseJson(filePath, originalName)
    : fileType === "xlsx" ? await parseWorkbook(filePath, originalName)
      : fileType === "csv" ? await parseDelimited(filePath, originalName)
        : await parsePdf(filePath, originalName);
  return { fileType, ...parsed };
}
