import fs from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express from "express";
import session from "express-session";
import { config, cookieOptions } from "./config.js";
import { getDb } from "./db/database.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import routes from "./routes/index.js";
import helmet from 'helmet';
import { startAuditWorker } from "./scrutiny/services/runWorker.js";

export function createApp() {
  getDb();
  startAuditWorker();
  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(session(cookieOptions(config.sessionTtlMs)));
  app.use(cookieParser());
  app.use("/api", routes);

  if (fs.existsSync(config.clientDist)) {
    app.use(express.static(config.clientDist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(config.clientDist, "index.html")));
  }
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
