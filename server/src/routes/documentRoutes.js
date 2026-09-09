import crypto from "node:crypto";
import fs from "node:fs";
import { Router } from "express";
import multer from "multer";
import { config } from "../config.js";
import { AppError } from "../errors.js";
import { createDocuments, deleteDocument, deleteDocuments, getCurrentDocument, listDocuments, updateDocumentsGstin, updateMapping, updateViewPreference } from "../services/documentService.js";

fs.mkdirSync(config.uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, config.uploadDir),
    filename: (_req, _file, callback) => callback(null, crypto.randomUUID()),
  }),
  limits: { fileSize: config.maxUploadBytes, files: 100 },
});

const router = Router();

router.get("/", (req, res) => res.json({ documents: listDocuments(req.user.id) }));

router.delete("/", async (req, res, next) => {
  try {
    const result = await deleteDocuments(req.user.id, req.body?.documentIds);
    res.status(result.errors.length ? 207 : 200).json(result);
  } catch (error) { next(error); }
});

router.put("/gstin", (req, res, next) => {
  try { res.json(updateDocumentsGstin(req.user.id, req.body || {})); }
  catch (error) { next(error); }
});

router.post("/upload", upload.array("files", 100), async (req, res, next) => {
  try {
    if (!req.files?.length) throw new AppError(400, "FILES_REQUIRED", "Choose at least one PDF, XLSX, CSV, or JSON document.");
    const result = await createDocuments(req.user.id, req.files);
    res.status(result.documents.length ? 201 : 422).json(result);
  } catch (error) { next(error); }
});

router.get("/:id", async (req, res, next) => {
  try { res.json({ document: await getCurrentDocument(req.user.id, req.params.id) }); }
  catch (error) { next(error); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await deleteDocument(req.user.id, req.params.id);
    res.status(204).end();
  } catch (error) { next(error); }
});

router.put("/:id/mapping", (req, res, next) => {
  try { res.json({ document: updateMapping(req.user.id, req.params.id, req.body || {}) }); }
  catch (error) { next(error); }
});

router.put("/:id/view-preference", (req, res, next) => {
  try { res.json({ document: updateViewPreference(req.user.id, req.params.id, req.body || {}) }); }
  catch (error) { next(error); }
});

export default router;
