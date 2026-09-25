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
  auditUploadDir: path.resolve(process.env.AUDIT_UPLOAD_DIR || path.join(dataDir, "audit-uploads")),
  auditExportDir: path.resolve(process.env.AUDIT_EXPORT_DIR || path.join(dataDir, "audit-exports")),
  clientDist: path.resolve(serverRoot, "../client/dist"),
  maxUploadBytes: 2 * 1024 * 1024,
  maxAuditUploadBytes: 25 * 1024 * 1024,
  maxAuditExportBytes: 100 * 1024 * 1024,
  maxAuditRecords: Number(process.env.AUDIT_MAX_RECORDS || 50_000),
  maxAuditRawRows: Number(process.env.AUDIT_MAX_RAW_ROWS || 75_000),
  maxAuditTextLines: Number(process.env.AUDIT_MAX_TEXT_LINES || 100_000),
  maxAuditWorkbookCells: Number(process.env.AUDIT_MAX_WORKBOOK_CELLS || 500_000),
  maxAuditUserStorageBytes: Number(process.env.AUDIT_MAX_USER_STORAGE_BYTES || 1024 * 1024 * 1024),
  maxConcurrentAuditParses: Number(process.env.AUDIT_MAX_CONCURRENT_PARSES || 1),
  sessionCookie: "gst_session",
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  sessionSecret: process.env.SESSION_SECRET || '7a23edca270f81cd2b1b62bbe6e0ec1f7db66b351c474c76701f30e09a47390d',
  express_session: process.env.EXPRESS_SESSION||true
};

export function cookieOptions(maxAge, man=false) {
  const cookie = {
      httpOnly: true,
      sameSite: "strict",
      secure: config.nodeEnv === "production",
      path: "/",
      maxAge,
  };
  return !config.express_session || man?
  cookie:{
    name: config.sessionCookie,
    resave: false,
    saveUninitialized: false,
    secret: config.sessionSecret,
    cookie
  }
}
