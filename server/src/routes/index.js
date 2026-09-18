import { Router } from "express";
import authRoutes from "./authRoutes.js";
import salesReconRoutes from "../sales_recon/app.js";

const router = Router();

router.get("/health", (_req, res) => res.json({ status: "ok" }));
router.use("/auth", authRoutes);
router.use('/sales',salesReconRoutes);

export default router;
