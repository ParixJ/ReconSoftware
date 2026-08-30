import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gst-books-recon-test-"));
process.env.NODE_ENV = "test";
process.env.GST_DATA_DIR = testRoot;
process.env.GST_DATABASE_PATH = path.join(testRoot, "test.sqlite");
process.env.GST_UPLOAD_DIR = path.join(testRoot, "uploads");

const { getDb, closeDb } = await import("../src/db/database.js");
const { parseGstr1Text } = await import("../src/parsers/gstr1.js");
const { parseGstr3bText } = await import("../src/parsers/gstr3b.js");
const { parseSalesRegisterMatrix } = await import("../src/parsers/salesRegister.js");
const { runReconciliation } = await import("../src/services/reconciliationService.js");

function insertDocument(userId, originalName, fileType, parsed) {
  const id = crypto.randomUUID();
  getDb().prepare(`
    INSERT INTO documents (
      id, user_id, original_name, stored_name, mime_type, file_type, document_type,
      gstin, return_period, status, record_count, parsed_data, mapping, anomalies, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, userId, originalName, id, null, fileType, parsed.documentType,
    parsed.gstin, parsed.returnPeriod, "ready", parsed.rows.length, JSON.stringify(parsed),
    JSON.stringify({ documentType: parsed.documentType, gstin: parsed.gstin, returnPeriod: parsed.returnPeriod, fieldMap: parsed.suggestedFieldMap || {} }),
    JSON.stringify(parsed.anomalies), new Date().toISOString(),
  );
  return id;
}

test("reconciles the selected sales-register period with GSTR-1 and GSTR-3B", () => {
  const userId = crypto.randomUUID();
  getDb().prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, "books@example.test", "Books Auditor", "test-only", new Date().toISOString());

  const headers = [
    "Bill Date", "Bill No", "C/D", "Party Name", "Party GSTIN No",
    "Assessable Amount", "Central Tax-9.00%", "State/UT Tax-9.00%",
    "Integrated Tax-18.00%", "Bill Amount",
  ];
  const books = parseSalesRegisterMatrix([
    ["DEMO COMPANY", "GSTIN 29AABFB5678G1Z8"],
    headers,
    ["30/04/2025", "INV-1", "Debit", "Registered buyer", "27AABCM1234F1ZX", 860000, 54900, 54900, 45000, 1014800],
    ["02/05/2025", "INV-2", "Debit", "Registered buyer", "27AABCM1234F1ZX", 10000, 900, 900, 0, 11800],
  ], "sales-register.xlsx");
  const gstr1 = parseGstr1Text(`
    FORM GSTR-1 GSTIN 29AABFB5678G1Z8 Tax period April 2025
    B2B regular invoices 1 Invoice 860,000.00 45,000.00 54,900.00 54,900.00 0.00
    B2B reverse charge 0 Invoice 0.00 0.00 0.00 0.00 0.00
    Other outward-supply sections
  `, "gstr-1-apr-2025.pdf");
  const gstr3b = parseGstr3bText(`
    FORM GSTR-3B GSTIN 29AABFB5678G1Z8 Period April 2025
    (a) Outward taxable supplies other than zero/nil/exempt 860,000.00 45,000.00 54,900.00 54,900.00 0.00
    (b) Outward taxable supplies - zero rated 0.00 0.00 - - 0.00
    (c) Other outward supplies - nil rated/exempt 0.00 - - - -
    (d) Inward supplies liable to reverse charge 0.00 0.00 0.00 0.00 0.00
    (e) Non-GST outward supplies 0.00 - - - -
  `, "gstr-3b-apr-2025.pdf");

  const documentIds = [
    insertDocument(userId, "sales-register.xlsx", "xlsx", books),
    insertDocument(userId, "gstr-1-apr-2025.pdf", "pdf", gstr1),
    insertDocument(userId, "gstr-3b-apr-2025.pdf", "pdf", gstr3b),
  ];
  const reconciliation = runReconciliation(userId, { documentIds, amountTolerance: 1, dateToleranceDays: 0 });

  assert.equal(reconciliation.status, "matched");
  assert.equal(reconciliation.result.summary.totalChecks, 19);
  const booksChecks = reconciliation.result.comparisons.filter((item) => item.kind === "books");
  assert.equal(booksChecks.length, 5);
  assert.ok(booksChecks.every((item) => item.status === "matched"));
  assert.equal(booksChecks[0].sourceLabel, "Sales register");
  assert.equal(booksChecks[0].filedLabel, "GSTR-1");
});

test.after(() => {
  closeDb();
  fs.rmSync(testRoot, { recursive: true, force: true });
});
