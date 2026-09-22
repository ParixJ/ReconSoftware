import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import auditReportRoutes from "./routes/auditReportRoutes.js";

const router = Router();
router.use("/audit-reports", requireAuth, auditReportRoutes);
export default router;
