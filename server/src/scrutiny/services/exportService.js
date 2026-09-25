import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { zipSync } from "fflate";
import { config } from "../../config.js";
import { getDb } from "../../db/database.js";
import { writeTransaction } from "../../db/transactions.js";
import { AppError } from "../../errors.js";
import { ERROR_CODES } from "../../api/errorCodes.js";

const jobView = (row) => ({ id: row.id, runIds: JSON.parse(row.run_ids_json), format: row.format,
  grouping: row.grouping, status: row.status, createdAt: row.created_at,
  finishedAt: row.finished_at, error: row.error_json ? JSON.parse(row.error_json) : null });

function loadRuns(userId, ids) {
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT n.*, r.name AS report_name, r.fiscal_year, r.taxpayer_id
    FROM scrutiny_runs n JOIN scrutiny_audit_reports r ON r.id = n.report_id
    WHERE n.user_id = ? AND r.user_id = ? AND n.id IN (${placeholders})`)
    .all(userId, userId, ...ids);
  if (rows.length !== ids.length || rows.some((row) => row.status !== "completed")) {
    throw new AppError(400, ERROR_CODES.INVALID_AUDIT_SELECTION,
      "Every export run must be completed and owned by this account.");
  }
  return rows.map((row) => ({ id: row.id, reportName: row.report_name, fiscalYear: row.fiscal_year,
    taxpayerId: row.taxpayer_id, createdAt: row.created_at, results: JSON.parse(row.result_json || "[]") }));
}

function comparisonRows(runs) {
  return runs.flatMap((run) => run.results.flatMap((result) => {
    const evidence = Array.isArray(result.evidence) && result.evidence.length ? result.evidence : [null];
    return evidence.map((item, index) => ({ fiscalYear: run.fiscalYear, report: run.reportName,
      runId: run.id, checkId: result.checkId, status: result.status,
      summary: result.summary, evidenceNumber: item ? index + 1 : null,
      comparison: item?.comparison || null, label: item?.label || item?.ledger || item?.category || null,
      expectedAmount: item?.expectedAmount ?? result.expectedAmount ?? null,
      actualAmount: item?.actualAmount ?? result.actualAmount ?? null,
      differenceAmount: item?.differenceAmount ?? result.differenceAmount ?? null,
      sourceRefs: item?.sourceRefs || [], details: item }));
  }));
}

async function xlsxBytes(runs) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ReconSoft";
  const summary = workbook.addWorksheet("Summary");
  summary.columns = [
    { header: "Fiscal year", key: "fiscalYear", width: 16 },
    { header: "Audit report", key: "report", width: 30 },
    { header: "Run ID", key: "runId", width: 40 },
    { header: "Check", key: "checkId", width: 12 },
    { header: "Status", key: "status", width: 18 },
    { header: "Summary", key: "summary", width: 80 },
  ];
  for (const run of runs) for (const result of run.results) summary.addRow({ fiscalYear: run.fiscalYear,
    report: run.reportName, runId: run.id, checkId: result.checkId,
    status: result.status, summary: result.summary });
  const detail = workbook.addWorksheet("Comparisons");
  detail.columns = [
    { header: "Fiscal year", key: "fiscalYear", width: 16 },
    { header: "Check", key: "checkId", width: 12 },
    { header: "Status", key: "status", width: 18 },
    { header: "Comparison", key: "comparison", width: 22 },
    { header: "Measure", key: "label", width: 40 },
    { header: "Expected", key: "expectedAmount", width: 20 },
    { header: "Actual", key: "actualAmount", width: 20 },
    { header: "Difference", key: "differenceAmount", width: 20 },
    { header: "Run ID", key: "runId", width: 40 },
    { header: "Evidence #", key: "evidenceNumber", width: 14 },
    { header: "Source references", key: "refs", width: 90 },
    { header: "Evidence JSON", key: "details", width: 90 },
  ];
  for (const row of comparisonRows(runs)) detail.addRow({ ...row,
    refs: JSON.stringify(row.sourceRefs), details: row.details ? JSON.stringify(row.details) : "" });
  for (const sheet of [summary, detail]) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: "A1", to: `${sheet === summary ? "F" : "L"}1` };
    sheet.getRow(1).font = { bold: true };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function pdfBytes(runs) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.once("error", reject);
    doc.once("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(18).text("ReconSoft scrutiny reconciliation");
    doc.moveDown(0.5).fontSize(9).text("Generated from saved, immutable scrutiny runs. OCR and review findings are not audit conclusions.");
    for (const run of runs) {
      doc.moveDown().fontSize(13).text(`${run.reportName} · ${run.fiscalYear}`);
      doc.fontSize(8).text(`Run ${run.id} · ${run.createdAt} · ${run.taxpayerId || "Taxpayer identity unverified"}`);
      for (const result of run.results) {
        doc.moveDown(0.5).fontSize(10).text(`${result.checkId} — ${result.status}`);
        doc.fontSize(8).text(result.summary);
        for (const row of result.evidence || []) {
          const line = [row.label || row.ledger || row.category || row.comparison || "Evidence",
            row.expectedAmount != null ? `expected ${row.expectedAmount}` : null,
            row.actualAmount != null ? `actual ${row.actualAmount}` : null,
            row.differenceAmount != null ? `difference ${row.differenceAmount}` : null,
          ].filter(Boolean).join(" · ");
          doc.text(line, { indent: 12 });
          doc.fontSize(7).text(JSON.stringify(row), { indent: 12 });
          doc.fontSize(8);
        }
      }
    }
    doc.end();
  });
}

async function outputBytes(runs, format, grouping) {
  const render = format === "xlsx" ? xlsxBytes : pdfBytes;
  if (grouping === "consolidated") return { bytes: await render(runs), extension: format };
  const years = new Map();
  for (const run of runs) {
    if (!years.has(run.fiscalYear)) years.set(run.fiscalYear, []);
    years.get(run.fiscalYear).push(run);
  }
  const files = {};
  for (const [year, group] of years) files[`scrutiny-${year}.${format}`] = new Uint8Array(await render(group));
  return { bytes: Buffer.from(zipSync(files)), extension: "zip" };
}

export function createAuditExport(userId, { runIds, format, grouping }) {
  if (!Array.isArray(runIds) || !runIds.length || runIds.length > 30 ||
      new Set(runIds).size !== runIds.length || runIds.some((id) => typeof id !== "string" || !id) ||
      !["xlsx", "pdf"].includes(format) || !["consolidated", "by_fy"].includes(grouping)) {
    throw new AppError(400, ERROR_CODES.INVALID_AUDIT_SELECTION, "Choose completed runs, XLSX or PDF, and a grouping mode.");
  }
  loadRuns(userId, runIds);
  const row = { id: crypto.randomUUID(), user_id: userId, run_ids_json: JSON.stringify(runIds),
    format, grouping, status: "queued", stored_name: null, error_json: null,
    created_at: new Date().toISOString(), finished_at: null };
  writeTransaction(getDb(), () => getDb().prepare(`INSERT INTO scrutiny_exports
    (id,user_id,run_ids_json,format,grouping,status,stored_name,error_json,created_at,finished_at)
    VALUES (@id,@user_id,@run_ids_json,@format,@grouping,@status,@stored_name,@error_json,@created_at,@finished_at)`).run(row));
  scheduleAuditExports();
  return jobView(row);
}

export function getAuditExport(userId, exportId) {
  const row = getDb().prepare("SELECT * FROM scrutiny_exports WHERE id = ? AND user_id = ?")
    .get(exportId, userId);
  if (!row) throw new AppError(404, ERROR_CODES.AUDIT_EXPORT_NOT_FOUND, "Scrutiny export not found.");
  return jobView(row);
}

export function getAuditExportFile(userId, exportId) {
  const row = getDb().prepare("SELECT * FROM scrutiny_exports WHERE id = ? AND user_id = ?")
    .get(exportId, userId);
  if (!row || row.status !== "completed" || !row.stored_name) {
    throw new AppError(404, ERROR_CODES.AUDIT_EXPORT_NOT_FOUND, "Completed scrutiny export not found.");
  }
  const filePath = path.resolve(config.auditExportDir, row.stored_name);
  if (path.dirname(filePath) !== config.auditExportDir) throw new AppError(500,
    ERROR_CODES.INVALID_STORED_FILE_PATH, "Scrutiny export path is invalid.");
  return { filePath, fileName: `ReconSoft-scrutiny-${row.id}.${path.extname(row.stored_name).slice(1)}` };
}

let exportActive = false;
let exportScheduled = false;
let interval;
const exportWorkerId = crypto.randomUUID();
async function processExports() {
  if (exportActive) return;
  exportActive = true;
  try {
    let row;
    while ((row = writeTransaction(getDb(), () => {
      getDb().prepare(`UPDATE scrutiny_exports SET status = 'queued', lease_owner = NULL,
        lease_until = NULL WHERE status = 'running' AND
        (lease_until < ? OR (lease_until IS NULL AND created_at < ?))`)
        .run(Date.now(), new Date(Date.now() - 60 * 60 * 1000).toISOString());
      const next = getDb().prepare("SELECT * FROM scrutiny_exports WHERE status = 'queued' ORDER BY created_at LIMIT 1").get();
      if (next) getDb().prepare(`UPDATE scrutiny_exports SET status = 'running',
        lease_owner = ?, lease_until = ? WHERE id = ? AND status = 'queued'`)
        .run(exportWorkerId, Date.now() + 60 * 60 * 1000, next.id);
      return next;
    }))) {
      let temp = null;
      try {
        const runs = loadRuns(row.user_id, JSON.parse(row.run_ids_json));
        const { bytes, extension } = await outputBytes(runs, row.format, row.grouping);
        if (bytes.length > config.maxAuditExportBytes) throw new Error("Export exceeds configured size limit.");
        await fs.mkdir(config.auditExportDir, { recursive: true });
        const storedName = `${row.id}-${exportWorkerId}.${extension}`;
        temp = path.join(config.auditExportDir, `${row.id}-${exportWorkerId}.tmp`);
        await fs.writeFile(temp, bytes, { flag: "wx" });
        const finalPath = path.join(config.auditExportDir, storedName);
        await fs.rename(temp, finalPath);
        temp = null;
        const update = writeTransaction(getDb(), () => getDb().prepare(`UPDATE scrutiny_exports SET
          status = 'completed', stored_name = ?, finished_at = ?, lease_owner = NULL, lease_until = NULL
          WHERE id = ? AND status = 'running' AND lease_owner = ?`)
          .run(storedName, new Date().toISOString(), row.id, exportWorkerId));
        if (!update.changes) await fs.rm(finalPath, { force: true });
      } catch {
        if (temp) await fs.rm(temp, { force: true }).catch(() => {});
        writeTransaction(getDb(), () => getDb().prepare(`UPDATE scrutiny_exports SET
          status = 'failed', error_json = ?, finished_at = ?, lease_owner = NULL, lease_until = NULL
          WHERE id = ? AND status = 'running' AND lease_owner = ?`)
          .run(JSON.stringify({ code: ERROR_CODES.AUDIT_EXPORT_FAILED,
            message: "The scrutiny export could not be generated." }), new Date().toISOString(), row.id, exportWorkerId));
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  } finally { exportActive = false; }
}

export function scheduleAuditExports() {
  if (exportActive || exportScheduled) return;
  exportScheduled = true;
  setImmediate(() => { exportScheduled = false; processExports().catch((error) => {
    if (process.env.NODE_ENV !== "test") console.error("Audit export worker failed", error);
  }); });
}

export function startAuditExportWorker() {
  getDb();
  scheduleAuditExports();
  if (!interval) { interval = setInterval(scheduleAuditExports, 60_000); interval.unref?.(); }
}
