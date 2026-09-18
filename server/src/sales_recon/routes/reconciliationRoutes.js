import { Router } from "express";
import { deleteReconciliation, getReconciliation, listReconciliations, runReconciliation } from "../services/reconciliationService.js";
import { exportReconciliationWorkbook, getReconciliationExportData } from "../services/reconciliationExportService.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try { res.json({ reconciliations: await listReconciliations(req.user.id) }); }
  catch (error) { next(error); }
});

router.post("/", async (req, res, next) => {
  try { res.status(201).json({ reconciliation: await runReconciliation(req.user.id, req.body || {}) }); }
  catch (error) { next(error); }
});

router.get("/export", async (req, res, next) => {
  try {
    const workbook = await exportReconciliationWorkbook(req.user.id, {
      clientGstin: req.query.gstin,
      year: req.query.year,
      fiscalYear: req.query.fiscalYear,
      filename: req.query.filename,
      format: req.query.format,
    });
    res.set({
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${workbook.filename}"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    res.send(workbook.buffer);
  } catch (error) { next(error); }
});

router.get("/export-data", async (req, res, next) => {
  try {
    res.json({ exportData: await getReconciliationExportData(req.user.id, {
      clientGstin: req.query.gstin,
      year: req.query.year,
      fiscalYear: req.query.fiscalYear,
      format: req.query.format,
    }) });
  } catch (error) { next(error); }
});

router.post("/export", async (req, res, next) => {
  try {
    const workbook = await exportReconciliationWorkbook(req.user.id, {
      clientGstin: req.body?.gstin || req.body?.clientGstin,
      year: req.body?.year,
      fiscalYear: req.body?.fiscalYear,
      filename: req.body?.filename,
      format: req.body?.format,
      rows: req.body?.rows,
    });
    res.set({
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${workbook.filename}"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    res.send(workbook.buffer);
  } catch (error) { next(error); }
});

router.get("/:id", async (req, res, next) => {
  try { res.json({ reconciliation: await getReconciliation(req.user.id, req.params.id) }); }
  catch (error) { next(error); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    deleteReconciliation(req.user.id, req.params.id);
    res.status(204).end();
  } catch (error) { next(error); }
});

export default router;

