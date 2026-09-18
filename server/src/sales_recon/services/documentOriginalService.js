import { ERROR_CODES } from "../../api/errorCodes.js";
import path from "node:path";
import { config } from "../../config.js";
import { getDb } from "../../db/database.js";
import { writeTransaction } from "../../db/transactions.js";
import { AppError } from "../../errors.js";
import { extractOriginalDocument } from "../parsers/originalDocument.js";
import { jsonSafeParse } from "../parsers/utils.js";
import { deserializeDocument } from "./documentService.js";

function storedFilePath(row) {
  const filePath = path.resolve(config.uploadDir, row.stored_name);
  const relativePath = path.relative(config.uploadDir, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new AppError(500, ERROR_CODES.INVALID_STORED_FILE_PATH, "The stored document path is invalid.");
  }
  return filePath;
}

function mergeFields(storedFields, extractedFields) {
  const fields = [];
  const seen = new Set();
  for (const field of [...storedFields, ...extractedFields]) {
    const name = String(field || "").trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      fields.push(name);
    }
  }
  return fields;
}

function saveMetadata(row, fields, headerRowNumber, existing) {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO document_org (
      document_id, user_id, field_names, header_row_number, extraction_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(document_id) DO UPDATE SET
      field_names = excluded.field_names,
      header_row_number = excluded.header_row_number,
      extraction_version = excluded.extraction_version,
      updated_at = excluded.updated_at
  `).run(
    row.id,
    row.user_id,
    JSON.stringify(fields),
    headerRowNumber,
    existing?.created_at || now,
    now,
  );
}

export async function getOriginalDocument(userId, id) {
  const db = getDb();
  let row = db.prepare("SELECT * FROM documents WHERE id = ? AND user_id = ?").get(id, userId);
  if (!row) throw new AppError(404, ERROR_CODES.DOCUMENT_NOT_FOUND, "This document does not exist or is not available to your account.");

  const metadata = db.prepare("SELECT * FROM document_org WHERE document_id = ? AND user_id = ?").get(id, userId);
  let extracted;
  try {
    extracted = await extractOriginalDocument(storedFilePath(row), row.original_name, row.mime_type, {
      fileType: row.file_type,
      headerRowNumber: metadata?.header_row_number,
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, ERROR_CODES.ORIGINAL_DOCUMENT_EXTRACTION_FAILED, "The original document fields could not be extracted. Upload the source file again.");
  }

  const originalFields = jsonSafeParse(metadata?.field_names, []);
  let fields = mergeFields(Array.isArray(originalFields) ? originalFields : [], extracted.fields || []);
  if (!metadata || JSON.stringify(fields) !== JSON.stringify(originalFields) || metadata.header_row_number !== extracted.headerRowNumber) {
    fields = writeTransaction(db, () => {
      row = db.prepare("SELECT * FROM documents WHERE id = ? AND user_id = ?").get(id, userId);
      if (!row) throw new AppError(404, ERROR_CODES.DOCUMENT_NOT_FOUND, "This document does not exist or is not available to your account.");
      const currentMetadata = db.prepare("SELECT * FROM document_org WHERE document_id = ? AND user_id = ?").get(id, userId);
      const storedFields = jsonSafeParse(currentMetadata?.field_names, []);
      const fields = mergeFields(Array.isArray(storedFields) ? storedFields : [], extracted.fields || []);
      if (!currentMetadata
        || JSON.stringify(fields) !== JSON.stringify(storedFields)
        || currentMetadata.header_row_number !== extracted.headerRowNumber) {
        saveMetadata(row, fields, extracted.headerRowNumber, currentMetadata);
      }
      return fields;
    });
  }

  const rows = (extracted.rows || []).map((sourceRow) => Object.fromEntries(
    fields.map((field) => [field, sourceRow?.[field] ?? null]),
  ));
  return {
    ...deserializeDocument(row),
    original: {
      fields,
      rows,
      rowCount: rows.length,
      extractionVersion: 1,
    },
  };
}
