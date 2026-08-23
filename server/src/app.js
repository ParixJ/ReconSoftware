import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import { config } from "./config.js";
import { getDb } from "./db/database.js";
import { requireAuth } from "./middleware/auth.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import authRoutes from "./routes/authRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import reconciliationRoutes from "./routes/reconciliationRoutes.js";

export function createApp() {
  getDb();
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/api/auth", authRoutes);
  app.use("/api/documents", requireAuth, documentRoutes);
  app.use("/api/reconciliations", requireAuth, reconciliationRoutes);

  if (fs.existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(config.clientDist, "index.html")));
  }
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

