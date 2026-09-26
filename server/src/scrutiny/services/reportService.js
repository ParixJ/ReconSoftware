import crypto from "node:crypto";
import path from "node:path";
import { config } from "../../config.js";
import { getDb } from "../../db/database.js";
import { writeTransaction } from "../../db/transactions.js";
import { AppError } from "../../errors.js";
import { ERROR_CODES } from "../../api/errorCodes.js";

const decode = (json, fallback) => {
  try { return json == null ? fallback : JSON.parse(json); } catch { return fallback; }
};
const reportView = (r) => ({ id: r.id, name: r.name, taxpayerId: r.taxpayer_id,
  fiscalYear: r.fiscal_year, sourceCount: r.source_count ?? undefined,
  runCount: r.run_count ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at });
function storedParsed(parsed) {
  const { records, rawRows, ledgerStatements, textLines, tables, ...metadata } = parsed;
  return { metadata: { ...metadata,
    ...(tables ? { tables: tables.map(({ rows, ...table }) => table) } : {}) },
  records: records || [], rawRows: rawRows || [], ledgerStatements: ledgerStatements || [], textLines: textLines || [] };
}

function flagLegacyBalanceInference(parsed, row) {
  // Older paired-column imports filled missing printed controls with zero.
  // Keep their stored evidence immutable, but prevent new runs from trusting
  // those balance fields until a corrected source revision is derived.
  if (Number(row.parser_version) >= 4 || row.role !== "books_ledgers" ||
      !parsed.records?.some((record) => record.entries?.some((entry) => Array.isArray(entry.details)))) return parsed;
  parsed.status = "insufficient_data";
  parsed.issues = [...(parsed.issues || []), { code: "AUDIT_LEGACY_BALANCE_INFERENCE",
    message: "This source was parsed before missing balance controls were preserved. Derive a corrected source from the original upload before balance-based checks." }];
  return parsed;
}

function hydratedParsed(db, row) {
  const parsed = decode(row.parsed_json, null);
  if (!parsed) return null;
  const stored = db.prepare(`SELECT collection, record_json FROM scrutiny_source_records
    WHERE source_id = ? AND user_id = ? AND report_id = ? ORDER BY collection, ordinal`)
    .all(row.id, row.user_id, row.report_id);
  if (!stored.length && Array.isArray(parsed.records)) return flagLegacyBalanceInference(parsed, row); // Sources saved before row storage.
  const collections = new Map();
  for (const item of stored) {
    if (!collections.has(item.collection)) collections.set(item.collection, []);
    collections.get(item.collection).push(JSON.parse(item.record_json));
  }
  parsed.records = collections.get("records") || [];
  parsed.rawRows = collections.get("rawRows") || [];
  if (collections.has("ledgerStatements")) parsed.ledgerStatements = collections.get("ledgerStatements");
  parsed.textLines = db.prepare(`SELECT line_json FROM scrutiny_source_text_lines
    WHERE source_id = ? ORDER BY ordinal`).all(row.id).map((item) => JSON.parse(item.line_json));
  if (Array.isArray(parsed.tables)) {
    const byTable = new Map();
    for (const record of parsed.records) {
      if (!record.tableId) continue;
      if (!byTable.has(record.tableId)) byTable.set(record.tableId, []);
      byTable.get(record.tableId).push(record);
    }
    parsed.tables = parsed.tables.map((table) => ({ ...table, rows: byTable.get(table.id) || [] }));
  }
  return flagLegacyBalanceInference(parsed, row);
}

const sourceView = (r, full = false) => {
  const parsedMetadata = decode(r.parsed_json, {});
  return { id: r.id, reportId: r.report_id, role: r.role,
  originalName: r.original_name, mimeType: r.mime_type, fileType: r.file_type,
  documentType: parsedMetadata.documentType ?? null,
  sizeBytes: r.size_bytes, sha256: r.sha256, parserVersion: r.parser_version, parseStatus: r.status,
  issues: decode(r.issues_json, []), createdAt: r.created_at,
  ...(full ? { parsed: hydratedParsed(getDb(), r) } : {}) };
};
const profileView = (row) => ({ id: row.id, name: row.name, version: row.version,
  role: row.role, configuration: decode(row.configuration_json, {}), status: row.status,
  createdAt: row.created_at, approvedAt: row.approved_at });
const runView = (r, full = false) => ({ id: r.id, reportId: r.report_id,
  selectedSourceIds: decode(r.selected_source_ids, []), checkIds: decode(r.check_ids, []),
  parameters: decode(r.run_params_json, {}),
  status: r.status, createdAt: r.created_at, startedAt: r.started_at,
  finishedAt: r.finished_at, error: decode(r.error_json, null),
  ...(full ? { results: decode(r.result_json, []) } : {}) });

function reportRow(db, userId, reportId) {
  const row = db.prepare("SELECT * FROM scrutiny_audit_reports WHERE id = ? AND user_id = ?")
    .get(reportId, userId);
  if (!row) throw new AppError(404, ERROR_CODES.AUDIT_REPORT_NOT_FOUND, "Audit report not found.");
  return row;
}

function runRow(db, userId, reportId, runId) {
  const row = db.prepare("SELECT * FROM scrutiny_runs WHERE id = ? AND report_id = ? AND user_id = ?")
    .get(runId, reportId, userId);
  if (!row) throw new AppError(404, ERROR_CODES.AUDIT_RUN_NOT_FOUND, "Audit run not found.");
  return row;
}

export function createAuditReport(userId, { name, taxpayerId = null, fiscalYear }) {
  const db = getDb();
  const now = new Date().toISOString();
  const row = { id: crypto.randomUUID(), user_id: userId, name, taxpayer_id: taxpayerId,
    fiscal_year: fiscalYear, created_at: now, updated_at: now };
  writeTransaction(db, () => db.prepare(`INSERT INTO scrutiny_audit_reports
    (id,user_id,name,taxpayer_id,fiscal_year,created_at,updated_at)
    VALUES (@id,@user_id,@name,@taxpayer_id,@fiscal_year,@created_at,@updated_at)`).run(row));
  return reportView(row);
}

export function listAuditReports(userId) {
  return getDb().prepare(`SELECT r.*,
    (SELECT COUNT(*) FROM scrutiny_sources s WHERE s.report_id = r.id) AS source_count,
    (SELECT COUNT(*) FROM scrutiny_runs n WHERE n.report_id = r.id) AS run_count
    FROM scrutiny_audit_reports r WHERE r.user_id = ? ORDER BY r.created_at DESC`)
    .all(userId).map(reportView);
}

export function getAuditReport(userId, reportId) {
  const db = getDb();
  const report = reportView(reportRow(db, userId, reportId));
  report.sources = db.prepare("SELECT * FROM scrutiny_sources WHERE report_id = ? AND user_id = ? ORDER BY created_at DESC")
    .all(reportId, userId).map((row) => sourceView(row));
  report.runs = db.prepare("SELECT * FROM scrutiny_runs WHERE report_id = ? AND user_id = ? ORDER BY created_at DESC")
    .all(reportId, userId).map((row) => runView(row));
  return report;
}

export function addAuditSource(userId, reportId, input) {
  const db = getDb();
  const now = new Date().toISOString();
  const parsed = storedParsed(input.parsed);
  const row = { id: input.id || crypto.randomUUID(), report_id: reportId, user_id: userId,
    role: input.role, original_name: input.originalName, stored_name: input.storedName,
    mime_type: input.mimeType || null, size_bytes: input.sizeBytes, file_type: input.fileType, sha256: input.sha256,
    parser_version: input.parserVersion || "1", status: input.status,
    parsed_json: JSON.stringify(parsed.metadata), issues_json: JSON.stringify(input.issues || []),
    created_at: now };
  writeTransaction(db, () => {
    reportRow(db, userId, reportId);
    const usedStorage = db.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM scrutiny_sources WHERE user_id = ?")
      .get(userId).bytes;
    if (usedStorage + row.size_bytes > config.maxAuditUserStorageBytes) {
      throw new AppError(413, ERROR_CODES.AUDIT_STORAGE_LIMIT_EXCEEDED,
        "Audit source storage limit exceeded. Delete older scrutiny evidence before uploading more sources.");
    }
    db.prepare(`INSERT INTO scrutiny_sources
      (id,report_id,user_id,role,original_name,stored_name,mime_type,size_bytes,file_type,
       sha256,parser_version,status,parsed_json,issues_json,created_at)
      VALUES (@id,@report_id,@user_id,@role,@original_name,@stored_name,@mime_type,@size_bytes,@file_type,
       @sha256,@parser_version,@status,@parsed_json,@issues_json,@created_at)`).run(row);
    const insertRecord = db.prepare(`INSERT INTO scrutiny_source_records
      (source_id,user_id,report_id,collection,ordinal,record_kind,ledger_key,period_key,reference_key,record_json)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    for (const collection of ["records", "rawRows", "ledgerStatements"]) {
      for (const [ordinal, record] of parsed[collection].entries()) {
        insertRecord.run(row.id, userId, reportId, collection, ordinal,
          String(record.kind || record.category || input.parsed.documentType || input.role),
          record.ledger ? String(record.ledger).trim().toUpperCase() : null,
          record.period || record.financialYear || null,
          record.reference || record.voucherId || record.billReference || null,
          JSON.stringify(record));
      }
    }
    const insertLine = db.prepare(`INSERT INTO scrutiny_source_text_lines
      (source_id,ordinal,page_number,line_json) VALUES (?,?,?,?)`);
    for (const [ordinal, line] of parsed.textLines.entries()) {
      insertLine.run(row.id, ordinal, line.page ?? line.pageNumber ?? null, JSON.stringify(line));
    }
    if (input.lineage) db.prepare(`INSERT INTO scrutiny_source_lineage
      (source_id,origin_source_id,supersedes_source_id,profile_id,created_at)
      VALUES (?,?,?,?,?)`).run(row.id, input.lineage.originSourceId,
      input.lineage.supersedesSourceId || null, input.lineage.profileId || null, now);
    db.prepare("UPDATE scrutiny_audit_reports SET updated_at = ? WHERE id = ? AND user_id = ?")
      .run(now, reportId, userId);
  });
  return sourceView(row);
}

export function getAuditSourceRows(userId, reportId, sourceId, collection, offset, limit) {
  const db = getDb();
  reportRow(db, userId, reportId);
  const source = db.prepare("SELECT id FROM scrutiny_sources WHERE id = ? AND report_id = ? AND user_id = ?")
    .get(sourceId, reportId, userId);
  if (!source) throw new AppError(404, ERROR_CODES.AUDIT_SOURCE_NOT_FOUND, "Audit source not found.");
  const total = db.prepare(`SELECT COUNT(*) AS count FROM scrutiny_source_records
    WHERE source_id = ? AND collection = ?`).get(sourceId, collection).count;
  const rows = db.prepare(`SELECT record_json FROM scrutiny_source_records
    WHERE source_id = ? AND collection = ? ORDER BY ordinal LIMIT ? OFFSET ?`)
    .all(sourceId, collection, limit, offset).map((item) => JSON.parse(item.record_json));
  return { rows, total, offset, limit };
}

export function getAuditSourcePreflight(userId, reportId, sourceId) {
  const db = getDb();
  reportRow(db, userId, reportId);
  const row = db.prepare("SELECT * FROM scrutiny_sources WHERE id = ? AND report_id = ? AND user_id = ?")
    .get(sourceId, reportId, userId);
  if (!row) throw new AppError(404, ERROR_CODES.AUDIT_SOURCE_NOT_FOUND, "Audit source not found.");
  const raw = getAuditSourceRows(userId, reportId, sourceId, "rawRows", 0, 20);
  const normalized = getAuditSourceRows(userId, reportId, sourceId, "records", 0, 500);
  const candidates = normalized.rows.filter((record) => record.ledger).map((record) => record.ledger);
  const proposedRoles = [];
  for (const ledger of [...new Set(candidates)].slice(0, 100)) {
    const tokens = String(ledger).toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(Boolean);
    const has = (word) => tokens.includes(word);
    const suggestions = [];
    if (has("sales") || has("sale")) suggestions.push("sales");
    if (has("purchase") || has("purchases")) suggestions.push("purchases");
    if (has("interest")) suggestions.push("interest_income");
    if (has("tds")) suggestions.push("tds_receivable");
    if (has("tcs")) suggestions.push("tcs_receivable");
    if (has("cash") && has("cgst")) suggestions.push("gst_cash_cgst");
    if (has("cash") && has("sgst")) suggestions.push("gst_cash_sgst");
    if (suggestions.length) proposedRoles.push({ ledger, suggestedRoles: suggestions,
      requiresApproval: true });
  }
  return { sourceId, parseStatus: row.status, issues: decode(row.issues_json, []),
    originalFieldNames: [...new Set(raw.rows.flatMap((item) => Object.keys(item)))],
    previewRows: raw.rows, proposedRoles };
}

export function createAuditMappingProfile(userId, { name, role, configuration }) {
  const db = getDb();
  return writeTransaction(db, () => {
    const version = db.prepare(`SELECT COALESCE(MAX(version), 0) + 1 AS version
      FROM scrutiny_mapping_profiles WHERE user_id = ? AND name = ?`).get(userId, name).version;
    const now = new Date().toISOString();
    const row = { id: crypto.randomUUID(), user_id: userId, name, role, version,
      configuration_json: JSON.stringify(configuration), status: "pending", created_at: now,
      approved_at: null };
    db.prepare(`INSERT INTO scrutiny_mapping_profiles
      (id,user_id,name,role,version,configuration_json,status,created_at,approved_at)
      VALUES (@id,@user_id,@name,@role,@version,@configuration_json,@status,@created_at,@approved_at)`).run(row);
    return profileView(row);
  });
}

export function listAuditMappingProfiles(userId) {
  return getDb().prepare(`SELECT * FROM scrutiny_mapping_profiles WHERE user_id = ?
    ORDER BY name, version DESC`).all(userId).map(profileView);
}

export function getAuditMappingProfile(userId, profileId, requireApproved = false) {
  const row = getDb().prepare(`SELECT * FROM scrutiny_mapping_profiles WHERE id = ? AND user_id = ?`)
    .get(profileId, userId);
  if (!row) throw new AppError(404, ERROR_CODES.AUDIT_PROFILE_NOT_FOUND, "Mapping profile not found.");
  if (requireApproved && row.status !== "approved") throw new AppError(409,
    ERROR_CODES.AUDIT_PROFILE_NOT_APPROVED, "Approve the mapping profile before deriving a source.");
  return profileView(row);
}

export function approveAuditMappingProfile(userId, profileId) {
  const db = getDb();
  return writeTransaction(db, () => {
    getAuditMappingProfile(userId, profileId);
    db.prepare(`UPDATE scrutiny_mapping_profiles SET status = 'approved', approved_at = COALESCE(approved_at, ?)
      WHERE id = ? AND user_id = ?`).run(new Date().toISOString(), profileId, userId);
    return getAuditMappingProfile(userId, profileId);
  });
}

export function getReusableAuditSource(userId, sourceId) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM scrutiny_sources WHERE id = ? AND user_id = ?")
    .get(sourceId, userId);
  if (!row) throw new AppError(404, ERROR_CODES.AUDIT_SOURCE_NOT_FOUND, "Audit source not found.");
  const lineage = db.prepare("SELECT * FROM scrutiny_source_lineage WHERE source_id = ?").get(sourceId);
  return { ...sourceView(row, true), originSourceId: lineage?.origin_source_id || sourceId,
    storedName: row.stored_name };
}

export function listReusableAuditSources(userId) {
  return getDb().prepare(`SELECT * FROM scrutiny_sources WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 1000`).all(userId).map((row) => sourceView(row));
}

export function getAuditSource(userId, reportId, sourceId) {
  const db = getDb();
  reportRow(db, userId, reportId);
  const row = db.prepare("SELECT * FROM scrutiny_sources WHERE id = ? AND report_id = ? AND user_id = ?")
    .get(sourceId, reportId, userId);
  if (!row) throw new AppError(404, ERROR_CODES.AUDIT_SOURCE_NOT_FOUND, "Audit source not found.");
  return sourceView(row, true);
}

export function getAuditSourceFile(userId, reportId, sourceId) {
  const db = getDb();
  reportRow(db, userId, reportId);
  const row = db.prepare("SELECT * FROM scrutiny_sources WHERE id = ? AND report_id = ? AND user_id = ?")
    .get(sourceId, reportId, userId);
  if (!row) throw new AppError(404, ERROR_CODES.AUDIT_SOURCE_NOT_FOUND, "Audit source not found.");
  const filePath = path.resolve(config.auditUploadDir, row.stored_name);
  if (path.dirname(filePath) !== config.auditUploadDir) {
    throw new AppError(500, ERROR_CODES.INVALID_STORED_FILE_PATH, "Audit source path is invalid.");
  }
  return { filePath, fileType: row.file_type, originalName: row.original_name };
}

export function createAuditRun(userId, reportId, { sourceIds, checkIds, parameters = {}, idempotencyKey = null }) {
  const db = getDb();
  return writeTransaction(db, () => {
    reportRow(db, userId, reportId);
    const ids = [...new Set(sourceIds)];
    if (!ids.length || ids.length !== sourceIds.length) {
      throw new AppError(400, ERROR_CODES.INVALID_AUDIT_SELECTION, "Select distinct audit sources.");
    }
    const placeholders = ids.map(() => "?").join(",");
    const count = db.prepare(`SELECT COUNT(*) AS n FROM scrutiny_sources
      WHERE user_id = ? AND report_id = ? AND id IN (${placeholders})`)
      .get(userId, reportId, ...ids).n;
    if (count !== ids.length) throw new AppError(400, ERROR_CODES.INVALID_AUDIT_SELECTION,
      "Selected sources must belong to this audit report.");
    if (idempotencyKey) {
      const existing = db.prepare(`SELECT * FROM scrutiny_runs
        WHERE user_id = ? AND report_id = ? AND idempotency_key = ?`)
        .get(userId, reportId, idempotencyKey);
      if (existing) {
        if (existing.selected_source_ids !== JSON.stringify(ids) || existing.check_ids !== JSON.stringify(checkIds) ||
            (existing.run_params_json || "{}") !== JSON.stringify(parameters)) {
          throw new AppError(409, ERROR_CODES.INVALID_AUDIT_SELECTION,
            "This idempotency key was used with a different selection.");
        }
        return runView(existing);
      }
    }
    const now = new Date().toISOString();
    const row = { id: crypto.randomUUID(), report_id: reportId, user_id: userId,
      selected_source_ids: JSON.stringify(ids), check_ids: JSON.stringify(checkIds),
      run_params_json: JSON.stringify(parameters),
      idempotency_key: idempotencyKey, status: "queued", result_json: null,
      error_json: null, lease_owner: null, lease_until: null,
      created_at: now, started_at: null, finished_at: null };
    db.prepare(`INSERT INTO scrutiny_runs
      (id,report_id,user_id,selected_source_ids,check_ids,idempotency_key,status,
       run_params_json,result_json,error_json,lease_owner,lease_until,created_at,started_at,finished_at)
      VALUES (@id,@report_id,@user_id,@selected_source_ids,@check_ids,@idempotency_key,@status,
       @run_params_json,@result_json,@error_json,@lease_owner,@lease_until,@created_at,@started_at,@finished_at)`).run(row);
    return runView(row);
  });
}

export function getAuditRun(userId, reportId, runId) {
  const db = getDb();
  reportRow(db, userId, reportId);
  return runView(runRow(db, userId, reportId, runId), true);
}

export function getAuditResults(userId, reportId, runId) {
  const db = getDb();
  reportRow(db, userId, reportId);
  const run = runRow(db, userId, reportId, runId);
  const reviews = db.prepare("SELECT * FROM scrutiny_reviews WHERE run_id = ? AND user_id = ? ORDER BY created_at")
    .all(runId, userId).map((r) => ({ id: r.id, resultId: r.result_id,
      decision: r.decision, note: r.note, createdAt: r.created_at }));
  return { results: decode(run.result_json, []), reviews };
}

export function getAuditComparisonRows(userId, reportId, runId, offset, limit) {
  const db = getDb();
  reportRow(db, userId, reportId);
  runRow(db, userId, reportId, runId);
  const total = db.prepare("SELECT COUNT(*) AS count FROM scrutiny_comparisons WHERE run_id = ?")
    .get(runId).count;
  const rows = db.prepare(`SELECT row_json FROM scrutiny_comparisons
    WHERE run_id = ? ORDER BY ordinal LIMIT ? OFFSET ?`).all(runId, limit, offset)
    .map((row) => JSON.parse(row.row_json));
  return { rows, total, offset, limit };
}

export function addAuditReview(userId, reportId, runId, resultId, { decision, note = "" }) {
  const db = getDb();
  return writeTransaction(db, () => {
    reportRow(db, userId, reportId);
    const run = runRow(db, userId, reportId, runId);
    if (!decode(run.result_json, []).some((result) => result.id === resultId)) {
      throw new AppError(404, ERROR_CODES.AUDIT_RESULT_NOT_FOUND, "Audit result not found.");
    }
    const row = { id: crypto.randomUUID(), run_id: runId, result_id: resultId,
      user_id: userId, decision, note, created_at: new Date().toISOString() };
    db.prepare(`INSERT INTO scrutiny_reviews (id,run_id,result_id,user_id,decision,note,created_at)
      VALUES (@id,@run_id,@result_id,@user_id,@decision,@note,@created_at)`).run(row);
    return { id: row.id, resultId, decision, note, createdAt: row.created_at };
  });
}

export function claimNextAuditRun(workerId) {
  const db = getDb();
  return writeTransaction(db, () => {
    db.prepare(`UPDATE scrutiny_runs SET status = 'queued', lease_owner = NULL,
      lease_until = NULL, started_at = NULL WHERE status = 'running' AND lease_until < ?`)
      .run(Date.now());
    const row = db.prepare(`SELECT n.*, r.taxpayer_id AS report_taxpayer_id
      FROM scrutiny_runs n JOIN scrutiny_audit_reports r ON r.id = n.report_id
      WHERE n.status = 'queued' ORDER BY n.created_at LIMIT 1`).get();
    if (!row) return null;
    const startedAt = new Date().toISOString();
    db.prepare(`UPDATE scrutiny_runs SET status = 'running', started_at = ?,
      lease_owner = ?, lease_until = ? WHERE id = ? AND status = 'queued'`)
      .run(startedAt, workerId, Date.now() + 60 * 60 * 1000, row.id);
    return { ...runView(row), status: "running", startedAt, userId: row.user_id,
      reportTaxpayerId: row.report_taxpayer_id };
  });
}

export function sourcesForAuditRun(run) {
  const ids = run.selectedSourceIds;
  const placeholders = ids.map(() => "?").join(",");
  return getDb().prepare(`SELECT * FROM scrutiny_sources WHERE user_id = ?
    AND report_id = ? AND id IN (${placeholders})`)
    .all(run.userId, run.reportId, ...ids).map((row) => sourceView(row, true));
}

export function completeAuditRun(runId, workerId, results) {
  writeTransaction(getDb(), (db) => {
    const update = db.prepare(`UPDATE scrutiny_runs
      SET status = 'completed', result_json = ?, error_json = NULL, finished_at = ?,
        lease_owner = NULL, lease_until = NULL
      WHERE id = ? AND status = 'running' AND lease_owner = ?`)
      .run(JSON.stringify(results), new Date().toISOString(), runId, workerId);
    if (!update.changes) return;
    const insert = db.prepare(`INSERT INTO scrutiny_comparisons
      (run_id,ordinal,check_id,status,comparison,row_json) VALUES (?,?,?,?,?,?)`);
    let ordinal = 0;
    for (const result of results) for (const evidence of result.evidence || []) {
      const row = { runId, checkId: result.checkId, status: result.status,
        summary: result.summary, ...evidence };
      insert.run(runId, ordinal++, result.checkId, result.status,
        evidence.comparison || null, JSON.stringify(row));
    }
  });
}

export function failAuditRun(runId, workerId) {
  writeTransaction(getDb(), (db) => db.prepare(`UPDATE scrutiny_runs
    SET status = 'failed', error_json = ?, finished_at = ?,
      lease_owner = NULL, lease_until = NULL
    WHERE id = ? AND status = 'running' AND lease_owner = ?`)
    .run(JSON.stringify({ code: ERROR_CODES.AUDIT_RUN_FAILED,
      message: "The scrutiny run could not be completed. Review its selected sources and try again." }),
    new Date().toISOString(), runId, workerId));
}
