import { Router } from "express";
import { getReconciliation, listReconciliations, runReconciliation } from "../services/reconciliationService.js";

const router = Router();

router.get("/", (req, res) => res.json({ reconciliations: listReconciliations(req.user.id) }));
router.post("/", async (req, res, next) => {
  try { res.status(201).json({ reconciliation: await runReconciliation(req.user.id, req.body || {}) }); }
  catch (error) { next(error); }
});
router.get("/:id", (req, res, next) => {
  try { res.json({ reconciliation: getReconciliation(req.user.id, req.params.id) }); }
  catch (error) { next(error); }
});

export default router;

