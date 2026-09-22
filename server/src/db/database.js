import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";
import { writeTransaction } from "./transactions.js";

let database;

export function getDb() {
  if (database) return database;

  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  database = new DatabaseSync(config.databasePath);
  try {
    database.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    writeTransaction(database, () => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE COLLATE NOCASE,
          name TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          original_name TEXT NOT NULL,
          stored_name TEXT NOT NULL,
          mime_type TEXT,
          file_type TEXT NOT NULL,
          document_type TEXT NOT NULL,
          gstin TEXT,
          return_period TEXT,
          status TEXT NOT NULL,
          record_count INTEGER NOT NULL DEFAULT 0,
          parsed_data TEXT NOT NULL,
          mapping TEXT NOT NULL DEFAULT '{}',
          anomalies TEXT NOT NULL DEFAULT '[]',
          view_preference TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_documents_user_created ON documents(user_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS document_org (
          document_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          field_names TEXT NOT NULL DEFAULT '[]',
          header_row_number INTEGER,
          extraction_version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_document_org_user ON document_org(user_id);

        CREATE TABLE IF NOT EXISTS reconciliations (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          selected_document_ids TEXT NOT NULL,
          amount_tolerance REAL NOT NULL,
          date_tolerance_days INTEGER NOT NULL,
          status TEXT NOT NULL,
          result_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_reconciliations_user_created ON reconciliations(user_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS scrutiny_audit_reports (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          taxpayer_id TEXT,
          fiscal_year TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_scrutiny_reports_user_created
          ON scrutiny_audit_reports(user_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS scrutiny_sources (
          id TEXT PRIMARY KEY,
          report_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL,
          original_name TEXT NOT NULL,
          stored_name TEXT NOT NULL,
          mime_type TEXT,
          size_bytes INTEGER NOT NULL,
          file_type TEXT NOT NULL,
          sha256 TEXT NOT NULL,
          parser_version TEXT NOT NULL,
          status TEXT NOT NULL,
          parsed_json TEXT NOT NULL,
          issues_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          FOREIGN KEY (report_id) REFERENCES scrutiny_audit_reports(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_scrutiny_sources_report_created
          ON scrutiny_sources(report_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS scrutiny_runs (
          id TEXT PRIMARY KEY,
          report_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          selected_source_ids TEXT NOT NULL,
          check_ids TEXT NOT NULL,
          idempotency_key TEXT,
          status TEXT NOT NULL,
          result_json TEXT,
          error_json TEXT,
          lease_owner TEXT,
          lease_until INTEGER,
          created_at TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          FOREIGN KEY (report_id) REFERENCES scrutiny_audit_reports(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_scrutiny_runs_report_created
          ON scrutiny_runs(report_id, created_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_scrutiny_runs_idempotency
          ON scrutiny_runs(report_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

        CREATE TABLE IF NOT EXISTS scrutiny_reviews (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          result_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          decision TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          FOREIGN KEY (run_id) REFERENCES scrutiny_runs(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_scrutiny_reviews_run_result
          ON scrutiny_reviews(run_id, result_id, created_at DESC);
      `);
      const documentColumns = database.prepare("PRAGMA table_info(documents)").all().map((column) => column.name);
      if (!documentColumns.includes("view_preference")) {
        database.exec("ALTER TABLE documents ADD COLUMN view_preference TEXT");
      }
      database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
    });
  } catch (error) {
    database.close();
    database = undefined;
    throw error;
  }
  return database;
}

export function closeDb() {
  if (database) {
    database.close();
    database = undefined;
  }
}
