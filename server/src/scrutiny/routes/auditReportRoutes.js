import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { config } from "../../config.js";
import { AppError } from "../../errors.js";
import { ERROR_CODES } from "../../api/errorCodes.js";
import {
  validateCreateAuditReportRequest,
  validateUploadAuditSourceMetadata,
  validateCreateAuditRunRequest,
  validateAuditReviewDecisionRequest,
} from "../api/validators.js";
import { parseAuditSource } from "../core/parseAuditSource.js";
import { taxpayerKey } from "../core/runScrutiny.js";
import {
  addAuditReview, addAuditSource, createAuditReport, createAuditRun, getAuditReport,
  getAuditResults, getAuditRun, getAuditSource, getAuditSourceFile, listAuditReports,
} from "../services/reportService.js";
import { scheduleAuditRuns } from "../services/runWorker.js";

fs.mkdirSync(config.auditUploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, config.auditUploadDir),
    filename: (_req, _file, callback) => callback(null, crypto.randomUUID()),
  }),
  limits: { files: 1, fileSize: config.maxAuditUploadBytes },
});

const router = Router();

function sourceFiscalYear(report, role) {
  if (role !== "prior_year_trial_balance") return report.fiscalYear;
  const start = Number(report.fiscalYear.slice(0, 4));
  return `${start - 1}-${start}`;
}

router.get("/", (req, res, next) => {
  try { res.json({ auditReports: listAuditReports(req.user.id) }); }
  catch (error) { next(error); }
});

router.post("/", (req, res, next) => {
  try {
    const body = validateCreateAuditReportRequest(req.body);
    res.status(201).json({ auditReport: createAuditReport(req.user.id, body) });
  } catch (error) { next(error); }
});

router.get("/:reportId", (req, res, next) => {
  try {
    const { sources, runs, ...auditReport } = getAuditReport(req.user.id, req.params.reportId);
    res.json({ auditReport, sources, runs });
  }
  catch (error) { next(error); }
});

router.post("/:reportId/sources", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError(400, ERROR_CODES.FILES_REQUIRED, "Choose one audit source file.");
    if (req.file.originalname.length > 255) throw new AppError(400, ERROR_CODES.AUDIT_SOURCE_INVALID,
      "The audit source filename is too long.");
    const extension = path.extname(req.file.originalname).toLowerCase();
    if (![".json", ".csv", ".xlsx", ".pdf"].includes(extension)) {
      throw new AppError(400, ERROR_CODES.UNSUPPORTED_FILE, "Upload a JSON, CSV, XLSX, or PDF audit source.");
    }
    if (extension === ".pdf") {
      const handle = await fsPromises.open(req.file.path, "r");
      try {
        const header = Buffer.alloc(5);
        await handle.read(header, 0, 5, 0);
        if (header.toString() !== "%PDF-") {
          throw new AppError(400, ERROR_CODES.INVALID_PDF, "The uploaded PDF has an invalid file header.");
        }
      } finally { await handle.close(); }
    }
    const metadata = validateUploadAuditSourceMetadata(req.body);
    const report = getAuditReport(req.user.id, req.params.reportId);
    const sourceId = crypto.randomUUID();
    const parsed = await parseAuditSource({
      filePath: req.file.path,
      originalName: req.file.originalname,
      role: metadata.role,
      sourceId,
      fiscalYear: sourceFiscalYear(report, metadata.role),
      taxpayerId: metadata.role === "books_vouchers" ? report.taxpayerId : undefined,
      completeExport: metadata.completeExport,
    });
    if (parsed.financialYear && parsed.financialYear !== sourceFiscalYear(report, metadata.role)) {
      parsed.status = "insufficient_data";
      parsed.issues.push({ code: "AUDIT_PERIOD_MISMATCH",
        message: "The source fiscal year differs from the expected year for this audit source role." });
    }
    if (report.taxpayerId && [parsed.taxpayerId, ...parsed.records.map((record) => record.taxpayerId)]
      .filter(Boolean).some((value) => taxpayerKey(value) !== taxpayerKey(report.taxpayerId))) {
      parsed.status = "insufficient_data";
      parsed.issues.push({ code: "AUDIT_TAXPAYER_MISMATCH",
        message: "The source identifies a different taxpayer from this audit report." });
    }
    const sha256 = crypto.createHash("sha256")
      .update(await fsPromises.readFile(req.file.path)).digest("hex");
    const source = addAuditSource(req.user.id, report.id, {
      id: sourceId, role: metadata.role, originalName: req.file.originalname,
      storedName: req.file.filename, mimeType: req.file.mimetype,
      sizeBytes: req.file.size, fileType: parsed.format,
      sha256, parserVersion: "1", status: parsed.status,
      parsed, issues: parsed.issues,
    });
    res.status(201).json({ source });
  } catch (error) {
    if (req.file) await fsPromises.unlink(req.file.path).catch(() => {});
    next(error);
  }
});

router.get("/:reportId/sources/:sourceId", (req, res, next) => {
  try { res.json({ source: getAuditSource(req.user.id, req.params.reportId, req.params.sourceId) }); }
  catch (error) { next(error); }
});

router.get("/:reportId/sources/:sourceId/file", (req, res, next) => {
  try {
    const source = getAuditSourceFile(req.user.id, req.params.reportId, req.params.sourceId);
    const mime = { pdf: "application/pdf", json: "application/json", csv: "text/csv",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }[source.fileType]
      || "application/octet-stream";
    const safeName = source.originalName.replace(/[^A-Za-z0-9._-]/g, "_");
    res.set({ "Cache-Control": "no-store", "Content-Type": mime,
      "Content-Disposition": `inline; filename="${safeName}"` });
    res.sendFile(source.filePath, (error) => { if (error) next(error); });
  } catch (error) { next(error); }
});

router.post("/:reportId/runs", (req, res, next) => {
  try {
    const body = validateCreateAuditRunRequest(req.body);
    const run = createAuditRun(req.user.id, req.params.reportId, {
      sourceIds: body.selectedSourceIds, checkIds: body.checkIds,
      idempotencyKey: body.idempotencyKey,
    });
    scheduleAuditRuns();
    res.status(202).json({ run });
  } catch (error) { next(error); }
});

router.get("/:reportId/runs/:runId", (req, res, next) => {
  try { res.json({ run: getAuditRun(req.user.id, req.params.reportId, req.params.runId) }); }
  catch (error) { next(error); }
});

router.get("/:reportId/runs/:runId/results", (req, res, next) => {
  try { res.json(getAuditResults(req.user.id, req.params.reportId, req.params.runId)); }
  catch (error) { next(error); }
});

router.put("/:reportId/runs/:runId/results/:resultId/decision", (req, res, next) => {
  try {
    const body = validateAuditReviewDecisionRequest(req.body);
    const review = addAuditReview(req.user.id, req.params.reportId, req.params.runId,
      req.params.resultId, body);
    res.json({ review });
  } catch (error) { next(error); }
});

export default router;
