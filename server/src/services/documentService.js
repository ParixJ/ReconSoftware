import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { getDb } from "../db/database.js";
import { AppError } from "../errors.js";
import { CANONICAL_FIELDS, DOCUMENT_TYPES } from "../api/contracts.js";
import { applyFieldMapping } from "../parsers/normalizers.js";
import { parseUploadedFile } from "../parsers/index.js";
import { GSTR1_PARSER_VERSION } from "../parsers/gstr1.js";
import { jsonSafeParse } from "../parsers/utils.js";

const FIELD_LABELS = Object.freeze({
  counterpartyGstin: "Counterparty GSTIN",
  tradeName: "Trade name",
  invoiceNumber: "Invoice number",
  taxableValue: "Taxable value",
  igst: "IGST",
  cgst: "CGST",
  sgst: "SGST / UTGST",
  cess: "Cess",
});

const REQUIRED_FIELD_GROUPS = Object.freeze({
  gstr1: [["invoiceNumber"], ["taxableValue"], ["counterpartyGstin", "tradeName"]],
  gstr2: [["invoiceNumber"], ["taxableValue"], ["counterpartyGstin", "tradeName"]],
  gstr2b: [["invoiceNumber"], ["taxableValue"], ["counterpartyGstin", "tradeName"]],
  gstr3b: [["taxableValue"], ["igst", "cgst", "sgst", "cess"]],
  salesRegister: [["invoiceDate"], ["taxableValue"], ["counterpartyGstin", "tradeName"]],
});

function mappingCoverage(parsed, mapping, documentType, preference) {
  const sourceFields = parsed.sourceFields || [];
  const sourceRows = parsed.sourceRows || [];
  const builtInSchema = parsed.builtInSchema === true || (sourceFields.length === 0 && documentType !== "unknown");
  const fieldMap = mapping.fieldMap || parsed.suggestedFieldMap || {};
  const matchedFields = Object.entries(fieldMap)
    .filter(([, source]) => source && sourceFields.includes(source))
    .map(([canonical]) => canonical);
  const groups = REQUIRED_FIELD_GROUPS[documentType] || [];
  const missingGroups = documentType === "unknown"
    ? [["documentType"], ["invoiceNumber"], ["taxableValue"], ["counterpartyGstin", "tradeName"]]
    : groups.filter((group) => !group.some((field) => matchedFields.includes(field)));
  const canRenderNormalized = builtInSchema || (groups.length > 0 && missingGroups.length === 0);
  const hasOriginalFields = sourceFields.length > 0 && sourceRows.length > 0;
  let viewMode = "normalized";
  if (!canRenderNormalized) {
    viewMode = !hasOriginalFields ? "hidden" : preference === "original" ? "original" : preference === "hidden" ? "hidden" : "prompt";
  }
  return {
    canRenderNormalized,
    builtInSchema,
    hasOriginalFields,
    matchedFields,
    missingFields: missingGroups.map((group) => group.map((field) => FIELD_LABELS[field] || "Document type").join(" or ")),
    viewMode,
  };
}

function deserialize(row, includeParsed = false) {
  if (!row) return null;
  const document = {
    id: row.id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    fileType: row.file_type,
    documentType: row.document_type,
    gstin: row.gstin,
    returnPeriod: row.return_period,
    status: row.status,
    recordCount: row.record_count,
    mapping: jsonSafeParse(row.mapping, {}),
    anomalies: jsonSafeParse(row.anomalies, []),
    viewPreference: row.view_preference || null,
    createdAt: row.created_at,
  };
  if (includeParsed) {
    document.parsed = jsonSafeParse(row.parsed_data, { rows: [], summary: {}, sourceFields: [], sourceRows: [] });
    document.mappingCoverage = mappingCoverage(document.parsed, document.mapping, document.documentType, document.viewPreference);
  }
  return document;
}

function insertDocument(userId, file, parsed) {
  const mapping = { documentType: parsed.documentType, gstin: parsed.gstin, returnPeriod: parsed.returnPeriod, fieldMap: parsed.suggestedFieldMap || {} };
  const coverage = mappingCoverage(parsed, mapping, parsed.documentType, null);
  const row = {
    id: crypto.randomUUID(),
    user_id: userId,
    original_name: file.originalname,
    stored_name: file.filename,
    mime_type: file.mimetype,
    file_type: parsed.fileType,
    document_type: parsed.documentType,
    gstin: parsed.gstin,
    return_period: parsed.returnPeriod,
    status: parsed.anomalies.some((item) => item.severity === "error") || !coverage.canRenderNormalized ? "needs_mapping" : "ready",
    record_count: parsed.rows.length,
    parsed_data: JSON.stringify(parsed),
    mapping: JSON.stringify(mapping),
    anomalies: JSON.stringify(parsed.anomalies),
    view_preference: null,
    created_at: new Date().toISOString(),
  };
  getDb().prepare(`
    INSERT INTO documents (
      id, user_id, original_name, stored_name, mime_type, file_type, document_type,
      gstin, return_period, status, record_count, parsed_data, mapping, anomalies, view_preference, created_at
    ) VALUES (
      @id, @user_id, @original_name, @stored_name, @mime_type, @file_type, @document_type,
      @gstin, @return_period, @status, @record_count, @parsed_data, @mapping, @anomalies, @view_preference, @created_at
    )
  `).run(row);
  return deserialize(row, true);
}

function storedFilePath(row) {
  const filePath = path.resolve(config.uploadDir, row.stored_name);
  const relativePath = path.relative(config.uploadDir, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new AppError(500, "INVALID_STORED_FILE_PATH", "The stored document path is invalid.");
  }
  return filePath;
}

async function removeStoredDocumentFile(row) {
  try {
    await fs.unlink(storedFilePath(row));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function bulkDocumentIds(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) {
    throw new AppError(400, "INVALID_DOCUMENT_SELECTION", "Select between 1 and 100 documents to delete.");
  }
  const documentIds = [...new Set(input.map((id) => String(id || "").trim()))];
  if (documentIds.some((id) => !id)) {
    throw new AppError(400, "INVALID_DOCUMENT_SELECTION", "Every selected document must have a valid ID.");
  }
  return documentIds;
}

function gstr1PdfNeedsRefresh(row, parsed) {
  return row.document_type === "gstr1"
    && row.file_type === "pdf"
    && Number(parsed?.parserVersion || 0) < GSTR1_PARSER_VERSION;
}

async function refreshParsedDocument(row) {
  const current = jsonSafeParse(row.parsed_data, null);
  if (!gstr1PdfNeedsRefresh(row, current)) return row;

  const reparsed = await parseUploadedFile(storedFilePath(row), row.original_name, row.mime_type);
  const mapping = jsonSafeParse(row.mapping, {
    documentType: row.document_type,
    gstin: row.gstin,
    returnPeriod: row.return_period,
    fieldMap: {},
  });
  const updated = applyFieldMapping(reparsed, mapping);
  const coverage = mappingCoverage(updated, mapping, updated.documentType, row.view_preference);
  const status = updated.anomalies.some((item) => item.severity === "error") || !coverage.canRenderNormalized ? "needs_mapping" : "ready";
  getDb().prepare(`
    UPDATE documents SET document_type = ?, gstin = ?, return_period = ?, status = ?, record_count = ?,
      parsed_data = ?, anomalies = ? WHERE id = ? AND user_id = ?
  `).run(
    updated.documentType,
    updated.gstin,
    updated.returnPeriod,
    status,
    updated.rows.length,
    JSON.stringify(updated),
    JSON.stringify(updated.anomalies),
    row.id,
    row.user_id,
  );
  return getDocumentRow(row.user_id, row.id);
}

export async function createDocuments(userId, files) {
  const outcomes = await Promise.all(files.map(async (file) => {
    try {
      const parsed = await parseUploadedFile(file.path, file.originalname, file.mimetype);
      return { document: insertDocument(userId, file, parsed) };
    } catch (error) {
      await fs.unlink(file.path).catch(() => {});
      return { error: { filename: file.originalname, code: error.code || "PARSE_FAILED", message: error.message || "The document could not be parsed." } };
    }
  }));
  return {
    documents: outcomes.flatMap((outcome) => outcome.document ? [outcome.document] : []),
    errors: outcomes.flatMap((outcome) => outcome.error ? [outcome.error] : []),
  };
}

export function listDocuments(userId) {
  return getDb().prepare("SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC").all(userId).map((row) => deserialize(row));
}

export function getDocumentRow(userId, id) {
  const row = getDb().prepare("SELECT * FROM documents WHERE id = ? AND user_id = ?").get(id, userId);
  if (!row) throw new AppError(404, "DOCUMENT_NOT_FOUND", "This document does not exist or is not available to your account.");
  return row;
}

export function getDocument(userId, id) {
  return deserialize(getDocumentRow(userId, id), true);
}

export async function getCurrentDocument(userId, id) {
  return deserialize(await refreshParsedDocument(getDocumentRow(userId, id)), true);
}

export async function deleteDocument(userId, id) {
  const row = getDocumentRow(userId, id);
  try {
    await removeStoredDocumentFile(row);
  } catch (error) {
    throw new AppError(500, "DOCUMENT_FILE_DELETE_FAILED", "The uploaded file could not be removed from storage.");
  }

  getDb().prepare("DELETE FROM documents WHERE id = ? AND user_id = ?").run(id, userId);
}

export async function deleteDocuments(userId, inputIds) {
  const documentIds = bulkDocumentIds(inputIds);
  const placeholders = documentIds.map(() => "?").join(", ");
  const rows = getDb().prepare(`SELECT * FROM documents WHERE user_id = ? AND id IN (${placeholders})`).all(userId, ...documentIds);
  if (rows.length !== documentIds.length) {
    throw new AppError(404, "DOCUMENTS_NOT_FOUND", "One or more selected documents do not exist or are not available to your account.");
  }

  const outcomes = await Promise.all(rows.map(async (row) => {
    try {
      await removeStoredDocumentFile(row);
      return { row };
    } catch {
      return {
        error: {
          id: row.id,
          originalName: row.original_name,
          code: "DOCUMENT_FILE_DELETE_FAILED",
          message: "The uploaded file could not be removed from storage.",
        },
      };
    }
  }));
  const deletedRows = outcomes.flatMap((outcome) => outcome.row ? [outcome.row] : []);
  if (deletedRows.length) {
    const deletedPlaceholders = deletedRows.map(() => "?").join(", ");
    getDb().prepare(`DELETE FROM documents WHERE user_id = ? AND id IN (${deletedPlaceholders})`)
      .run(userId, ...deletedRows.map((row) => row.id));
  }
  return {
    deletedIds: deletedRows.map((row) => row.id),
    errors: outcomes.flatMap((outcome) => outcome.error ? [outcome.error] : []),
  };
}

export function updateMapping(userId, id, input) {
  const row = getDocumentRow(userId, id);
  const parsed = jsonSafeParse(row.parsed_data, null);
  if (!parsed) throw new AppError(422, "PARSED_DATA_MISSING", "The parsed document data is unavailable. Upload the source again.");

  const requestedDocumentType = String(input.documentType || "unknown");
  const documentType = requestedDocumentType.toLowerCase().replace(/_/g, "") === "salesregister"
    ? "salesRegister"
    : requestedDocumentType.toLowerCase();
  if (!DOCUMENT_TYPES.includes(documentType)) throw new AppError(400, "INVALID_DOCUMENT_TYPE", "Choose a supported GST return type.");
  const gstin = String(input.gstin || "").trim().toUpperCase();
  if (gstin && gstin.length > 15) throw new AppError(400, "INVALID_GSTIN", "GSTIN cannot be longer than 15 characters.");
  const returnPeriod = String(input.returnPeriod || "").replace(/\D/g, "");
  if (returnPeriod && !/^(0[1-9]|1[0-2])\d{4}$/.test(returnPeriod)) throw new AppError(400, "INVALID_PERIOD", "Return period must use MMYYYY format.");

  const fieldMap = input.fieldMap && typeof input.fieldMap === "object" ? input.fieldMap : {};
  for (const [canonical, source] of Object.entries(fieldMap)) {
    if (!CANONICAL_FIELDS.includes(canonical)) throw new AppError(400, "INVALID_MAPPING_FIELD", `${canonical} is not a supported reconciliation field.`);
    if (source && !parsed.sourceFields?.includes(source)) throw new AppError(400, "INVALID_SOURCE_FIELD", `${source} is not a source column in this document.`);
  }
  const mapping = { documentType, gstin: gstin || null, returnPeriod: returnPeriod || null, fieldMap };
  const updated = applyFieldMapping(parsed, mapping);
  const coverage = mappingCoverage(updated, mapping, updated.documentType, row.view_preference);
  const status = updated.anomalies.some((item) => item.severity === "error") || !coverage.canRenderNormalized ? "needs_mapping" : "ready";
  getDb().prepare(`
    UPDATE documents SET document_type = ?, gstin = ?, return_period = ?, status = ?, record_count = ?,
      parsed_data = ?, mapping = ?, anomalies = ? WHERE id = ? AND user_id = ?
  `).run(updated.documentType, updated.gstin, updated.returnPeriod, status, updated.rows.length,
    JSON.stringify(updated), JSON.stringify(mapping), JSON.stringify(updated.anomalies), id, userId);
  return getDocument(userId, id);
}

export function updateViewPreference(userId, id, input) {
  getDocumentRow(userId, id);
  const mode = String(input.mode || "").toLowerCase();
  if (!["original", "hidden"].includes(mode)) {
    throw new AppError(400, "INVALID_VIEW_PREFERENCE", "Choose whether to render the original extracted columns or keep the table hidden.");
  }
  getDb().prepare("UPDATE documents SET view_preference = ? WHERE id = ? AND user_id = ?").run(mode, id, userId);
  return getDocument(userId, id);
}

export async function rowsForReconciliation(userId, ids) {
  return Promise.all(ids.map(async (id) => {
    const row = await refreshParsedDocument(getDocumentRow(userId, id));
    return { ...deserialize(row), parsed: jsonSafeParse(row.parsed_data, { rows: [], summary: {} }) };
  }));
}
