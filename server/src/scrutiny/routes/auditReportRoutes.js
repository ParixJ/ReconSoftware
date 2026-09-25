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
  validateCreateAuditProfileRequest,
  validateDeriveAuditSourceRequest,
  validateCreateAuditExportRequest,
} from "../api/validators.js";
import { parseAuditSource } from "../core/parseAuditSource.js";
import { taxpayerKey } from "../core/runScrutiny.js";
import {
  addAuditReview, addAuditSource, createAuditReport, createAuditRun, getAuditReport,
  getAuditResults, getAuditRun, getAuditSource, getAuditSourceFile, listAuditReports,
  getAuditSourceRows, createAuditMappingProfile, listAuditMappingProfiles,
  approveAuditMappingProfile, getAuditMappingProfile, getReusableAuditSource,
  listReusableAuditSources,
  getAuditSourcePreflight, getAuditComparisonRows,
} from "../services/reportService.js";
import { scheduleAuditRuns } from "../services/runWorker.js";
import { createAuditExport, getAuditExport, getAuditExportFile } from "../services/exportService.js";

fs.mkdirSync(config.auditUploadDir, { recursive: true });
let activeAuditParses = 0;
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, config.auditUploadDir),
    filename: (_req, _file, callback) => callback(null, crypto.randomUUID()),
  }),
  limits: { files: 1, fileSize: config.maxAuditUploadBytes },
});

const router = Router();

async function withAuditParseSlot(work) {
  if (activeAuditParses >= config.maxConcurrentAuditParses) {
    throw new AppError(429, ERROR_CODES.AUDIT_PARSE_BUSY,
      "Another audit source is being parsed. Retry this upload shortly.");
  }
  activeAuditParses += 1;
  try { return await work(); }
  finally { activeAuditParses -= 1; }
}

function sourceFiscalYear(report, role) {
  if (role !== "prior_year_trial_balance") return report.fiscalYear;
  const start = Number(report.fiscalYear.slice(0, 4));
  return `${start - 1}-${start}`;
}

function expectedParsedYear(report, role, parsed) {
  if (role === "prior_year_trial_balance" || parsed.documentType === "tax_computation") {
    const start = Number(report.fiscalYear.slice(0, 4));
    return `${start - 1}-${start}`;
  }
  return report.fiscalYear;
}

function verifyParsedIdentity(report, role, parsed) {
  if (parsed.financialYear && parsed.financialYear !== expectedParsedYear(report, role, parsed)) {
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
}

router.get("/mapping-profiles", (req, res, next) => {
  try { res.json({ profiles: listAuditMappingProfiles(req.user.id) }); }
  catch (error) { next(error); }
});

router.get("/source-library", (req, res, next) => {
  try { res.json({ sources: listReusableAuditSources(req.user.id) }); }
  catch (error) { next(error); }
});

router.post("/mapping-profiles", (req, res, next) => {
  try {
    const body = validateCreateAuditProfileRequest(req.body);
    res.status(201).json({ profile: createAuditMappingProfile(req.user.id, body) });
  } catch (error) { next(error); }
});

router.post("/mapping-profiles/:profileId/approve", (req, res, next) => {
  try { res.json({ profile: approveAuditMappingProfile(req.user.id, req.params.profileId) }); }
  catch (error) { next(error); }
});

router.post("/exports", (req, res, next) => {
  try { res.status(202).json({ export: createAuditExport(req.user.id, validateCreateAuditExportRequest(req.body)) }); }
  catch (error) { next(error); }
});

router.get("/exports/:exportId", (req, res, next) => {
  try { res.json({ export: getAuditExport(req.user.id, req.params.exportId) }); }
  catch (error) { next(error); }
});

router.get("/exports/:exportId/file", (req, res, next) => {
  try {
    const file = getAuditExportFile(req.user.id, req.params.exportId);
    res.set("Cache-Control", "no-store");
    res.download(file.filePath, file.fileName, (error) => { if (error) next(error); });
  } catch (error) { next(error); }
});

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
    if (![".json", ".csv", ".xlsx", ".xls", ".xml", ".pdf"].includes(extension)) {
      throw new AppError(400, ERROR_CODES.UNSUPPORTED_FILE, "Upload a JSON, CSV, XLSX, XLS, XML, or PDF audit source.");
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
    const profile = metadata.profileId ? getAuditMappingProfile(req.user.id, metadata.profileId, true) : null;
    if (profile && profile.role !== metadata.role) throw new AppError(400, ERROR_CODES.INVALID_AUDIT_PROFILE,
      "The mapping profile role does not match this source.");
    const sourceId = crypto.randomUUID();
    const parsed = await withAuditParseSlot(() => parseAuditSource({
      filePath: req.file.path,
      originalName: req.file.originalname,
      role: metadata.role,
      sourceId,
      fiscalYear: sourceFiscalYear(report, metadata.role),
      completeExport: metadata.completeExport,
      profile: profile?.configuration,
    }));
    if (profile) parsed.mappingProfile = { id: profile.id, version: profile.version };
    verifyParsedIdentity(report, metadata.role, parsed);
    const sha256 = crypto.createHash("sha256")
      .update(await fsPromises.readFile(req.file.path)).digest("hex");
    const source = addAuditSource(req.user.id, report.id, {
      id: sourceId, role: metadata.role, originalName: req.file.originalname,
      storedName: req.file.filename, mimeType: req.file.mimetype,
      sizeBytes: req.file.size, fileType: parsed.format,
      sha256, parserVersion: "4", status: parsed.status,
      parsed, issues: parsed.issues,
      ...(profile ? { lineage: { originSourceId: sourceId, profileId: profile.id } } : {}),
    });
    res.status(201).json({ source });
  } catch (error) {
    if (req.file) await fsPromises.unlink(req.file.path).catch(() => {});
    next(error);
  }
});

router.post("/:reportId/sources/derive", async (req, res, next) => {
  try {
    const body = validateDeriveAuditSourceRequest(req.body);
    const report = getAuditReport(req.user.id, req.params.reportId);
    const original = getReusableAuditSource(req.user.id, body.fromSourceId);
    const profile = body.profileId ? getAuditMappingProfile(req.user.id, body.profileId, true) : null;
    if (profile && profile.role !== original.role) throw new AppError(400, ERROR_CODES.INVALID_AUDIT_PROFILE,
      "The mapping profile role does not match this source.");
    const filePath = path.resolve(config.auditUploadDir, original.storedName);
    if (path.dirname(filePath) !== config.auditUploadDir) throw new AppError(500,
      ERROR_CODES.INVALID_STORED_FILE_PATH, "Audit source path is invalid.");
    const sourceId = crypto.randomUUID();
    const parsed = await withAuditParseSlot(() => parseAuditSource({ filePath, originalName: original.originalName,
      role: original.role, sourceId, fiscalYear: sourceFiscalYear(report, original.role),
      completeExport: body.completeExport,
      profile: profile?.configuration || null }));
    if (profile) parsed.mappingProfile = { id: profile.id, version: profile.version };
    verifyParsedIdentity(report, original.role, parsed);
    if (original.reportId !== report.id && original.parsed?.financialYear &&
        original.parsed.financialYear !== expectedParsedYear(report, original.role, parsed) &&
        !parsed.coverageYears?.includes(report.fiscalYear)) {
      parsed.status = "insufficient_data";
      parsed.issues.push({ code: "AUDIT_CROSS_YEAR_COVERAGE_UNVERIFIED",
        message: "The original source does not establish coverage for this report year." });
    }
    const source = addAuditSource(req.user.id, report.id, {
      id: sourceId, role: original.role, originalName: original.originalName,
      storedName: original.storedName, mimeType: original.mimeType,
      sizeBytes: original.sizeBytes, fileType: parsed.format, sha256: original.sha256,
      parserVersion: "4", status: parsed.status, parsed, issues: parsed.issues,
      lineage: { originSourceId: original.originSourceId,
        supersedesSourceId: original.reportId === report.id ? original.id : null,
        profileId: profile?.id || null },
    });
    res.status(201).json({ source });
  } catch (error) { next(error); }
});

router.get("/:reportId/sources/:sourceId", (req, res, next) => {
  try { res.json({ source: getAuditSource(req.user.id, req.params.reportId, req.params.sourceId) }); }
  catch (error) { next(error); }
});

router.get("/:reportId/sources/:sourceId/rows", (req, res, next) => {
  try {
    const collection = req.query.collection === "rawRows" ? "rawRows" : "records";
    const offset = Number(req.query.offset ?? 0);
    const limit = Number(req.query.limit ?? 100);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new AppError(400, ERROR_CODES.AUDIT_SOURCE_INVALID, "Use a nonnegative offset and limit of 1 to 500.");
    }
    res.json(getAuditSourceRows(req.user.id, req.params.reportId, req.params.sourceId,
      collection, offset, limit));
  } catch (error) { next(error); }
});

router.get("/:reportId/sources/:sourceId/preflight", (req, res, next) => {
  try { res.json({ preflight: getAuditSourcePreflight(req.user.id, req.params.reportId, req.params.sourceId) }); }
  catch (error) { next(error); }
});

router.get("/:reportId/sources/:sourceId/file", (req, res, next) => {
  try {
    const source = getAuditSourceFile(req.user.id, req.params.reportId, req.params.sourceId);
    const mime = { pdf: "application/pdf", json: "application/json", csv: "text/csv", xml: "application/xml",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      xls: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }[source.fileType]
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
      parameters: body.parameters || {},
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

router.get("/:reportId/runs/:runId/comparisons", (req, res, next) => {
  try {
    const offset = Number(req.query.offset ?? 0);
    const limit = Number(req.query.limit ?? 100);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new AppError(400, ERROR_CODES.INVALID_AUDIT_SELECTION,
        "Use a nonnegative offset and limit of 1 to 500.");
    }
    res.json(getAuditComparisonRows(req.user.id, req.params.reportId, req.params.runId, offset, limit));
  } catch (error) { next(error); }
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
