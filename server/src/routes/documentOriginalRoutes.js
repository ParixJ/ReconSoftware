import { Router } from "express";
import { getOriginalDocument } from "../services/documentOriginalService.js";

const router = Router();

router.get("/:id", async (req, res, next) => {
  try { res.json({ document: await getOriginalDocument(req.user.id, req.params.id) }); }
  catch (error) { next(error); }
});

export default router;

