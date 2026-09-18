import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import documentOriginalRoutes from "./routes/documentOriginalRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import reconciliationRoutes from "./routes/reconciliationRoutes.js";

const router = Router();

router.use("/document-org", requireAuth, documentOriginalRoutes);
router.use("/documents", requireAuth, documentRoutes);
router.use("/reconciliations", requireAuth, reconciliationRoutes);

export default router;
