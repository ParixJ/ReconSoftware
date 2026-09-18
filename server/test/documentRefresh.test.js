import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gst-parser-refresh-test-"));
process.env.NODE_ENV = "test";
process.env.GST_DATA_DIR = testRoot;
process.env.GST_DATABASE_PATH = path.join(testRoot, "test.sqlite");
process.env.GST_UPLOAD_DIR = path.join(testRoot, "uploads");

const { getDb, closeDb } = await import("../src/db/database.js");
const { getCurrentDocument } = await import("../src/sales_recon/services/documentService.js");
const { getOriginalDocument } = await import("../src/sales_recon/services/documentOriginalService.js");
const { GSTR1_PARSER_VERSION } = await import("../src/sales_recon/parsers/gstr1.js");

test("reparses a stored GSTR-1 PDF created by an older parser", async () => {
  const userId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const storedName = crypto.randomUUID();
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const sourcePdf = path.join(projectRoot, "node_modules/pdf-parse/test/data/04-valid.pdf");
  fs.mkdirSync(process.env.GST_UPLOAD_DIR, { recursive: true });
  fs.copyFileSync(sourcePdf, path.join(process.env.GST_UPLOAD_DIR, storedName));

  getDb().prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, "refresh@example.test", "Parser Refresh", "test-only", new Date().toISOString());
  const staleParsed = {
    parserVersion: GSTR1_PARSER_VERSION - 1,
    documentType: "gstr1",
    gstin: null,
    returnPeriod: "052025",
    rows: [{ section: "9B-CDNR", category: "taxableOutward", taxableValue: -20900 }],
    summary: { taxableOutward: { taxableValue: -20900 } },
    sourceFields: [],
    sourceRows: [],
    builtInSchema: true,
    anomalies: [],
  };
  const mapping = { documentType: "gstr1", gstin: "29AABFB5678G1Z8", returnPeriod: "052025", fieldMap: {} };
  getDb().prepare(`
    INSERT INTO documents (
      id, user_id, original_name, stored_name, mime_type, file_type, document_type,
      gstin, return_period, status, record_count, parsed_data, mapping, anomalies, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    documentId, userId, "gstr1-may-2025.pdf", storedName, "application/pdf", "pdf", "gstr1",
    mapping.gstin, mapping.returnPeriod, "ready", staleParsed.rows.length, JSON.stringify(staleParsed),
    JSON.stringify(mapping), JSON.stringify([]), new Date().toISOString(),
  );

  const refreshed = await getCurrentDocument(userId, documentId);

  assert.equal(refreshed.parsed.parserVersion, GSTR1_PARSER_VERSION);
  assert.equal(refreshed.gstin, mapping.gstin);
  assert.ok(!refreshed.parsed.rows.some((row) => row.section === "9B-CDNR"));
  assert.equal(
    JSON.parse(getDb().prepare("SELECT parsed_data FROM documents WHERE id = ?").get(documentId).parsed_data).parserVersion,
    GSTR1_PARSER_VERSION,
  );

  const original = await getOriginalDocument(userId, documentId);
  assert.equal(original.parsed, undefined);
  assert.ok(original.original.fields.length > 0);
  assert.equal(getDb().prepare("SELECT document_id FROM document_org WHERE document_id = ?").get(documentId).document_id, documentId);
});

test.after(() => {
  closeDb();
  fs.rmSync(testRoot, { recursive: true, force: true });
});
