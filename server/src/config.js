import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(moduleDir, "..");
const dataDir = path.resolve(process.env.GST_DATA_DIR || path.join(serverRoot, "data"));

export const config = {
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || "127.0.0.1",
  nodeEnv: process.env.NODE_ENV || "development",
  dataDir,
  databasePath: path.resolve(process.env.GST_DATABASE_PATH || path.join(dataDir, "gst-reconciliation.sqlite")),
  uploadDir: path.resolve(process.env.GST_UPLOAD_DIR || path.join(dataDir, "uploads")),
  clientDist: path.resolve(serverRoot, "../client/dist"),
  maxUploadBytes: 20 * 1024 * 1024,
  sessionCookie: "gst_session",
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
};

