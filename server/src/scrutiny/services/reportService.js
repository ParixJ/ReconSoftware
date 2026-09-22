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
const sourceView = (r, full = false) => ({ id: r.id, reportId: r.report_id, role: r.role,
  originalName: r.original_name, mimeType: r.mime_type, fileType: r.file_type,
  sizeBytes: r.size_bytes, sha256: r.sha256, parserVersion: r.parser_version, parseStatus: r.status,
  issues: decode(r.issues_json, []), createdAt: r.created_at,
  ...(full ? { parsed: decode(r.parsed_json, null) } : {}) });
const runView = (r, full = false) => ({ id: r.id, reportId: r.report_id,
  selectedSourceIds: decode(r.selected_source_ids, []), checkIds: decode(r.check_ids, []),
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
  const row = { id: input.id || crypto.randomUUID(), report_id: reportId, user_id: userId,
    role: input.role, original_name: input.originalName, stored_name: input.storedName,
    mime_type: input.mimeType || null, size_bytes: input.sizeBytes, file_type: input.fileType, sha256: input.sha256,
    parser_version: input.parserVersion || "1", status: input.status,
    parsed_json: JSON.stringify(input.parsed), issues_json: JSON.stringify(input.issues || []),
    created_at: now };
  writeTransaction(db, () => {
    reportRow(db, userId, reportId);
    db.prepare(`INSERT INTO scrutiny_sources
      (id,report_id,user_id,role,original_name,stored_name,mime_type,size_bytes,file_type,
       sha256,parser_version,status,parsed_json,issues_json,created_at)
      VALUES (@id,@report_id,@user_id,@role,@original_name,@stored_name,@mime_type,@size_bytes,@file_type,
       @sha256,@parser_version,@status,@parsed_json,@issues_json,@created_at)`).run(row);
    db.prepare("UPDATE scrutiny_audit_reports SET updated_at = ? WHERE id = ? AND user_id = ?")
      .run(now, reportId, userId);
  });
  return sourceView(row);
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

export function createAuditRun(userId, reportId, { sourceIds, checkIds, idempotencyKey = null }) {
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
        if (existing.selected_source_ids !== JSON.stringify(ids) || existing.check_ids !== JSON.stringify(checkIds)) {
          throw new AppError(409, ERROR_CODES.INVALID_AUDIT_SELECTION,
            "This idempotency key was used with a different selection.");
        }
        return runView(existing);
      }
    }
    const now = new Date().toISOString();
    const row = { id: crypto.randomUUID(), report_id: reportId, user_id: userId,
      selected_source_ids: JSON.stringify(ids), check_ids: JSON.stringify(checkIds),
      idempotency_key: idempotencyKey, status: "queued", result_json: null,
      error_json: null, lease_owner: null, lease_until: null,
      created_at: now, started_at: null, finished_at: null };
    db.prepare(`INSERT INTO scrutiny_runs
      (id,report_id,user_id,selected_source_ids,check_ids,idempotency_key,status,
       result_json,error_json,lease_owner,lease_until,created_at,started_at,finished_at)
      VALUES (@id,@report_id,@user_id,@selected_source_ids,@check_ids,@idempotency_key,@status,
       @result_json,@error_json,@lease_owner,@lease_until,@created_at,@started_at,@finished_at)`).run(row);
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
    const row = db.prepare("SELECT * FROM scrutiny_runs WHERE status = 'queued' ORDER BY created_at LIMIT 1").get();
    if (!row) return null;
    const startedAt = new Date().toISOString();
    db.prepare(`UPDATE scrutiny_runs SET status = 'running', started_at = ?,
      lease_owner = ?, lease_until = ? WHERE id = ? AND status = 'queued'`)
      .run(startedAt, workerId, Date.now() + 60 * 60 * 1000, row.id);
    return { ...runView(row), status: "running", startedAt, userId: row.user_id };
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
  writeTransaction(getDb(), (db) => db.prepare(`UPDATE scrutiny_runs
    SET status = 'completed', result_json = ?, error_json = NULL, finished_at = ?,
      lease_owner = NULL, lease_until = NULL
    WHERE id = ? AND status = 'running' AND lease_owner = ?`)
    .run(JSON.stringify(results), new Date().toISOString(), runId, workerId));
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
