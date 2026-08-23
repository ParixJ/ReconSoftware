import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";

let database;

export function getDb() {
  if (database) return database;

  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  database = new DatabaseSync(config.databasePath);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
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
  `);
  const documentColumns = database.prepare("PRAGMA table_info(documents)").all().map((column) => column.name);
  if (!documentColumns.includes("view_preference")) {
    database.exec("ALTER TABLE documents ADD COLUMN view_preference TEXT");
  }
  database.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  return database;
}

export function closeDb() {
  if (database) {
    database.close();
    database = undefined;
  }
}
