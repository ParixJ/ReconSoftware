import { Router } from "express";
import { getReconciliation, listReconciliations, runReconciliation } from "../services/reconciliationService.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try { res.json({ reconciliations: await listReconciliations(req.user.id) }); }
  catch (error) { next(error); }
});
router.post("/", async (req, res, next) => {
  try { res.status(201).json({ reconciliation: await runReconciliation(req.user.id, req.body || {}) }); }
  catch (error) { next(error); }
});
router.get("/:id", async (req, res, next) => {
  try { res.json({ reconciliation: await getReconciliation(req.user.id, req.params.id) }); }
  catch (error) { next(error); }
});

export default router;

