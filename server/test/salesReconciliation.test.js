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
const { normalizeJson } = await import("../src/parsers/normalizers.js");
const { parseSalesRegisterMatrix } = await import("../src/parsers/salesRegister.js");
const { updateMapping } = await import("../src/services/documentService.js");
const { exportReconciliationWorkbook } = await import("../src/services/reconciliationExportService.js");
const { getReconciliation, listReconciliations, runReconciliation } = await import("../src/services/reconciliationService.js");
const { strFromU8, unzipSync } = await import("fflate");
const { readSheet } = await import("read-excel-file/node");

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

function workbookCell(xml, cell) {
  const match = xml.match(new RegExp(`<c\\s+r="${cell}"[^>]*>\\s*<v>([^<]*)<\\/v>`));
  assert.ok(match, `Expected workbook cell ${cell}`);
  return Number(match[1]);
}

test("reconciles the selected sales-register period with GSTR-1 and GSTR-3B", async () => {
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
  const reconciliation = await runReconciliation(userId, { documentIds, amountTolerance: 1, dateToleranceDays: 0 });

  assert.equal(reconciliation.status, "matched");
  assert.equal(reconciliation.result.summary.totalChecks, 24);
  const booksChecks = reconciliation.result.comparisons.filter((item) => item.kind.startsWith("books"));
  assert.equal(booksChecks.length, 10);
  assert.ok(booksChecks.every((item) => item.status === "matched"));
  assert.equal(booksChecks[0].sourceLabel, "Sales register");
  assert.equal(booksChecks[0].filedLabel, "GSTR-1");

  const workbook = await exportReconciliationWorkbook(userId, { clientGstin: "29AABFB5678G1Z8", year: "2025" });
  const files = unzipSync(new Uint8Array(workbook.buffer));
  const workbookXml = strFromU8(files["xl/workbook.xml"]);
  const taxableXml = strFromU8(files["xl/worksheets/sheet1.xml"]);
  const outputTaxXml = strFromU8(files["xl/worksheets/sheet2.xml"]);
  assert.equal(workbook.filename, "GST_Reconciliation_29AABFB5678G1Z8_2025.xlsx");
  assert.match(workbookXml, /name="Taxable Value"/);
  assert.match(workbookXml, /name="Output Tax"/);
  assert.match(taxableXml, /mergeCell ref="B1:E1"/);
  assert.match(outputTaxXml, /mergeCell ref="J1:M1"/);
  assert.deepEqual(["B3", "C3", "D3", "E3", "F3", "G3", "H3", "I3", "J3", "K3", "L3", "M3", "N3"].map((cell) => workbookCell(taxableXml, cell)), [860000, 0, 0, 860000, 860000, 860000, 860000, 0, 0, 860000, 1014800, 0, 0]);
  assert.deepEqual(["B3", "C3", "D3", "E3", "F3", "G3", "H3", "I3", "J3", "K3", "L3", "M3", "N3", "O3"].map((cell) => workbookCell(outputTaxXml, cell)), [45000, 54900, 54900, 154800, 45000, 54900, 54900, 154800, 45000, 54900, 54900, 154800, 0, 0]);
  assert.equal(workbookCell(taxableXml, "E15"), 860000);
  assert.equal(workbookCell(outputTaxXml, "E15"), 154800);
  const taxableSheet = await readSheet(workbook.buffer, "Taxable Value");
  const outputTaxSheet = await readSheet(workbook.buffer, "Output Tax");
  assert.deepEqual(taxableSheet[2].slice(0, 14), ["April", 860000, 0, 0, 860000, 860000, 860000, 860000, 0, 0, 860000, 1014800, 0, 0]);
  assert.deepEqual(outputTaxSheet[2].slice(0, 15), ["April", 45000, 54900, 54900, 154800, 45000, 54900, 54900, 154800, 45000, 54900, 54900, 154800, 0, 0]);
});

test("exports the template's GSTR-1 credit-note and books columns with the expected signs", async () => {
  const userId = crypto.randomUUID();
  const gstin = "29AABFB5678G1Z8";
  getDb().prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, "excel-notes@example.test", "Excel Auditor", "test-only", new Date().toISOString());
  const gstr1 = normalizeJson({
    gstin,
    fp: "052025",
    b2b: [{ ctin: "27AABCM1234F1ZX", inv: [{ inum: "B2B-1", idt: "01-05-2025", val: 1960437, itms: [{ itm_det: { txval: 1609174, iamt: 76821.3, camt: 106976.76, samt: 106976.76 } }] }] }],
    b2cs: [{ pos: "29", txval: 27250 }],
    cdnr: [{ ctin: "27AABCM1234F1ZX", nt: [{ nt_num: "CN-1", nt_dt: "20-05-2025", ntty: "C", txval: 20900 }] }],
  }, "gstr1-may-2025.json");
  const gstr3b = normalizeJson({
    gstin,
    ret_period: "052025",
    sup_details: { osup_det: { txval: 1615524, iamt: 76821.3, camt: 106976.76, samt: 106976.76 } },
  }, "gstr3b-may-2025.json");
  const books = parseSalesRegisterMatrix([
    ["DEMO COMPANY", `GSTIN ${gstin}`],
    ["Bill Date", "Bill No", "Party Name", "Party GSTIN No", "Assessable Amount", "Integrated Tax-18.00%", "Central Tax-9.00%", "State/UT Tax-9.00%", "Bill Amount"],
    ["01/05/2025", "B2B-1", "Registered buyer", "27AABCM1234F1ZX", 1609174, 76821.3, 111105.96, 111105.96, 1960437],
    ["02/05/2025", "B2C-1", "Consumer", "", 27250, 0, 0, 0, 27250],
  ], "sales-register-may.xlsx");
  const documentIds = [
    insertDocument(userId, "sales-register-may.xlsx", "xlsx", books),
    insertDocument(userId, "gstr1-may-2025.json", "json", gstr1),
    insertDocument(userId, "gstr3b-may-2025.json", "json", gstr3b),
  ];
  await runReconciliation(userId, { documentIds, amountTolerance: 1, dateToleranceDays: 0 });

  const workbook = await exportReconciliationWorkbook(userId, { clientGstin: gstin, year: "2025" });
  const files = unzipSync(new Uint8Array(workbook.buffer));
  const taxableXml = strFromU8(files["xl/worksheets/sheet1.xml"]);
  const outputTaxXml = strFromU8(files["xl/worksheets/sheet2.xml"]);
  assert.deepEqual(["B4", "C4", "D4", "E4", "F4", "G4", "H4", "I4", "J4", "K4", "L4", "M4", "N4"].map((cell) => workbookCell(taxableXml, cell)), [1609174, 27250, 20900, 1615524, 1615524, 1615524, 1609174, 27250, 0, 1636424, 1960437, 0, 20900]);
  assert.deepEqual(["B4", "C4", "D4", "E4", "F4", "G4", "H4", "I4", "J4", "K4", "L4", "M4", "N4", "O4"].map((cell) => workbookCell(outputTaxXml, cell)), [76821.3, 106976.76, 106976.76, 290774.82, 76821.3, 106976.76, 106976.76, 290774.82, 76821.3, 111105.96, 111105.96, 299033.22, 0, 8258.4]);
});

test("removes a resolved GSTIN exception from reconciliation GET results", async () => {
  const userId = crypto.randomUUID();
  const gstin = "29AABFB5678G1Z8";
  getDb().prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, "resolved-exception@example.test", "Exception Auditor", "test-only", new Date().toISOString());

  const gstr1 = parseGstr1Text(`
    FORM GSTR-1 Tax period April 2025
    B2B regular invoices 1 Invoice 860,000.00 45,000.00 54,900.00 54,900.00 0.00
    B2B reverse charge 0 Invoice 0.00 0.00 0.00 0.00 0.00
    Other outward-supply sections
  `, "gstr-1-apr-2025.pdf");
  const gstr3b = parseGstr3bText(`
    FORM GSTR-3B GSTIN ${gstin} Period April 2025
    (a) Outward taxable supplies other than zero/nil/exempt 860,000.00 45,000.00 54,900.00 54,900.00 0.00
    (b) Outward taxable supplies - zero rated 0.00 0.00 - - 0.00
    (c) Other outward supplies - nil rated/exempt 0.00 - - - -
    (d) Inward supplies liable to reverse charge 0.00 0.00 0.00 0.00 0.00
    (e) Non-GST outward supplies 0.00 - - - -
  `, "gstr-3b-apr-2025.pdf");
  const gstr1Id = insertDocument(userId, "gstr-1-apr-2025.pdf", "pdf", gstr1);
  const gstr3bId = insertDocument(userId, "gstr-3b-apr-2025.pdf", "pdf", gstr3b);

  const initial = await runReconciliation(userId, { documentIds: [gstr1Id, gstr3bId], amountTolerance: 1, dateToleranceDays: 0 });
  const missingGstin = initial.result.exceptions.find((exception) => exception.code === "MISSING_CLIENT_GSTIN");
  assert.equal(initial.result.crossExamination.status, "partial");
  assert.equal(initial.result.comparisons.length, 0);
  assert.ok(missingGstin.id.startsWith(`exception:${gstr1Id}:042025:gstin:`));
  assert.equal(missingGstin.rootField, "gstin");

  updateMapping(userId, gstr1Id, { documentType: "gstr1", gstin, returnPeriod: "042025", fieldMap: {} });

  const refreshed = await getReconciliation(userId, initial.id);
  assert.ok(!refreshed.result.exceptions.some((exception) => exception.id === missingGstin.id));
  assert.equal(refreshed.result.crossExamination.status, "matched");
  assert.equal(refreshed.result.comparisons.length, 14);
  assert.equal(refreshed.result.summary.exceptions, 0);
  assert.equal(refreshed.status, "matched");
  const listed = await listReconciliations(userId);
  assert.ok(!listed[0].result.exceptions.some((exception) => exception.id === missingGstin.id));
});

test("reconciles multiple return months independently against matching sales-register periods", async () => {
  const userId = crypto.randomUUID();
  const gstin = "29AABFB5678G1Z8";
  getDb().prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, "multi-period@example.test", "Period Auditor", "test-only", new Date().toISOString());
  const headers = [
    "Bill Date", "Bill No", "C/D", "Party Name", "Party GSTIN No",
    "Assessable Amount", "Central Tax-9.00%", "State/UT Tax-9.00%",
    "Integrated Tax-18.00%", "Bill Amount",
  ];
  const books = parseSalesRegisterMatrix([
    ["DEMO COMPANY", `GSTIN ${gstin}`],
    headers,
    ["15/04/2025", "APR-1", "Debit", "April buyer", "27AABCM1234F1ZX", 1000, 90, 90, 0, 1180],
    ["15/05/2025", "MAY-1", "Debit", "May buyer", "27AABCM1234F1ZX", 2000, 180, 180, 0, 2360],
  ], "sales-register.xlsx");
  const aprilGstr1 = parseGstr1Text(`
    FORM GSTR-1 GSTIN ${gstin} Tax period April 2025
    B2B regular invoices 1 Invoice 1,000.00 0.00 90.00 90.00 0.00
    B2B reverse charge 0 Invoice 0.00 0.00 0.00 0.00 0.00
    Other outward-supply sections
  `, "gstr-1-apr-2025.pdf");
  const mayGstr1 = parseGstr1Text(`
    FORM GSTR-1 GSTIN ${gstin} Tax period May 2025
    B2B regular invoices 1 Invoice 2,000.00 0.00 180.00 180.00 0.00
    B2B reverse charge 0 Invoice 0.00 0.00 0.00 0.00 0.00
    Other outward-supply sections
  `, "gstr-1-may-2025.pdf");
  const aprilGstr3b = parseGstr3bText(`
    FORM GSTR-3B GSTIN ${gstin} Period April 2025
    (a) Outward taxable supplies other than zero/nil/exempt 1,000.00 0.00 90.00 90.00 0.00
    (b) Outward taxable supplies - zero rated 0.00 0.00 - - 0.00
    (c) Other outward supplies - nil rated/exempt 0.00 - - - -
    (d) Inward supplies liable to reverse charge 0.00 0.00 0.00 0.00 0.00
    (e) Non-GST outward supplies 0.00 - - - -
  `, "gstr-3b-apr-2025.pdf");
  const mayGstr3b = parseGstr3bText(`
    FORM GSTR-3B GSTIN ${gstin} Period May 2025
    (a) Outward taxable supplies other than zero/nil/exempt 2,000.00 0.00 180.00 180.00 0.00
    (b) Outward taxable supplies - zero rated 0.00 0.00 - - 0.00
    (c) Other outward supplies - nil rated/exempt 0.00 - - - -
    (d) Inward supplies liable to reverse charge 0.00 0.00 0.00 0.00 0.00
    (e) Non-GST outward supplies 0.00 - - - -
  `, "gstr-3b-may-2025.pdf");
  const salesRegisterId = insertDocument(userId, "sales-register.xlsx", "xlsx", books);
  const aprilGstr1Id = insertDocument(userId, "gstr-1-apr-2025.pdf", "pdf", aprilGstr1);
  const aprilGstr3bId = insertDocument(userId, "gstr-3b-apr-2025.pdf", "pdf", aprilGstr3b);
  const mayGstr1Id = insertDocument(userId, "gstr-1-may-2025.pdf", "pdf", mayGstr1);
  const mayGstr3bId = insertDocument(userId, "gstr-3b-may-2025.pdf", "pdf", mayGstr3b);
  const documentIds = [salesRegisterId, aprilGstr1Id, aprilGstr3bId, mayGstr1Id, mayGstr3bId];

  const reconciliation = await runReconciliation(userId, { documentIds, amountTolerance: 1, dateToleranceDays: 0 });

  assert.equal(reconciliation.status, "matched");
  assert.deepEqual(reconciliation.result.periods.map((item) => item.returnPeriod), ["042025", "052025"]);
  assert.equal(reconciliation.result.summary.totalChecks, 48);
  for (const [returnPeriod, expectedTaxable] of [["042025", 1000], ["052025", 2000]]) {
    const periodResult = reconciliation.result.periods.find((item) => item.returnPeriod === returnPeriod);
    assert.equal(periodResult.summary.totalChecks, 24);
    assert.equal(periodResult.exceptions.length, 0);
    assert.equal(periodResult.comparisons.find((item) => item.table === "Books to GSTR-1" && item.measure === "taxableValue").sourceValue, expectedTaxable);
    assert.equal(periodResult.comparisons.find((item) => item.table === "Books to GSTR-3B" && item.measure === "taxableValue").sourceValue, expectedTaxable);
    assert.equal(periodResult.comparisons.find((item) => item.table === "3.1(a)" && item.measure === "taxableValue").sourceValue, expectedTaxable);
  }
  assert.ok(!reconciliation.result.exceptions.some((exception) => exception.code === "PERIOD_MISMATCH"));

  updateMapping(userId, mayGstr1Id, { documentType: "gstr1", gstin: "24AEXPS3034H1Z6", returnPeriod: "052025", fieldMap: {} });
  const crossClientRefresh = await getReconciliation(userId, reconciliation.id);
  assert.equal(crossClientRefresh.status, "needs_review");
  assert.equal(crossClientRefresh.result.crossExamination.status, "mismatch");
  assert.equal(crossClientRefresh.result.comparisons.length, 0);
  assert.ok(crossClientRefresh.result.periods.every((item) => item.exceptions.some((exception) => exception.code === "GSTIN_MISMATCH" && exception.rootField === "gstin")));
});

test("adds an identified period exception when the sales register lacks a selected return month", async () => {
  const userId = crypto.randomUUID();
  const gstin = "29AABFB5678G1Z8";
  getDb().prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, "missing-books-period@example.test", "Books Period Auditor", "test-only", new Date().toISOString());
  const headers = [
    "Bill Date", "Bill No", "C/D", "Party Name", "Party GSTIN No",
    "Assessable Amount", "Central Tax-9.00%", "State/UT Tax-9.00%",
    "Integrated Tax-18.00%", "Bill Amount",
  ];
  const books = parseSalesRegisterMatrix([
    ["DEMO COMPANY", `GSTIN ${gstin}`],
    headers,
    ["15/04/2025", "APR-1", "Debit", "April buyer", "27AABCM1234F1ZX", 1000, 90, 90, 0, 1180],
  ], "sales-register-april.xlsx");
  const gstr1 = parseGstr1Text(`
    FORM GSTR-1 GSTIN ${gstin} Tax period May 2025
    B2B regular invoices 1 Invoice 2,000.00 0.00 180.00 180.00 0.00
    B2B reverse charge 0 Invoice 0.00 0.00 0.00 0.00 0.00
    Other outward-supply sections
  `, "gstr-1-may-2025.pdf");
  const gstr3b = parseGstr3bText(`
    FORM GSTR-3B GSTIN ${gstin} Period May 2025
    (a) Outward taxable supplies other than zero/nil/exempt 2,000.00 0.00 180.00 180.00 0.00
    (b) Outward taxable supplies - zero rated 0.00 0.00 - - 0.00
    (c) Other outward supplies - nil rated/exempt 0.00 - - - -
    (d) Inward supplies liable to reverse charge 0.00 0.00 0.00 0.00 0.00
    (e) Non-GST outward supplies 0.00 - - - -
  `, "gstr-3b-may-2025.pdf");
  const documentIds = [
    insertDocument(userId, "sales-register-april.xlsx", "xlsx", books),
    insertDocument(userId, "gstr-1-may-2025.pdf", "pdf", gstr1),
    insertDocument(userId, "gstr-3b-may-2025.pdf", "pdf", gstr3b),
  ];

  const reconciliation = await runReconciliation(userId, { documentIds, amountTolerance: 1, dateToleranceDays: 0 });
  const may = reconciliation.result.periods.find((item) => item.returnPeriod === "052025");
  const exception = may.exceptions.find((item) => item.code === "BOOKS_PERIOD_NOT_FOUND");

  assert.equal(may.comparisons.filter((item) => item.kind.startsWith("books")).length, 0);
  assert.equal(may.comparisons.find((item) => item.table === "3.1(a)" && item.measure === "taxableValue").difference, 0);
  assert.equal(exception.rootField, "periods.052025");
  assert.ok(exception.id.includes(":052025:periods.052025:BOOKS_PERIOD_NOT_FOUND:"));
  assert.equal(reconciliation.status, "needs_review");
});

test("does not sum duplicate returns within the same month", async () => {
  const userId = crypto.randomUUID();
  const gstin = "29AABFB5678G1Z8";
  getDb().prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, "duplicate-period@example.test", "Duplicate Period Auditor", "test-only", new Date().toISOString());
  const gstr1 = parseGstr1Text(`
    FORM GSTR-1 GSTIN ${gstin} Tax period April 2025
    B2B regular invoices 1 Invoice 1,000.00 0.00 90.00 90.00 0.00
    B2B reverse charge 0 Invoice 0.00 0.00 0.00 0.00 0.00
    Other outward-supply sections
  `, "gstr-1-apr-2025.pdf");
  const gstr3b = parseGstr3bText(`
    FORM GSTR-3B GSTIN ${gstin} Period April 2025
    (a) Outward taxable supplies other than zero/nil/exempt 1,000.00 0.00 90.00 90.00 0.00
    (b) Outward taxable supplies - zero rated 0.00 0.00 - - 0.00
    (c) Other outward supplies - nil rated/exempt 0.00 - - - -
    (d) Inward supplies liable to reverse charge 0.00 0.00 0.00 0.00 0.00
    (e) Non-GST outward supplies 0.00 - - - -
  `, "gstr-3b-apr-2025.pdf");
  const documentIds = [
    insertDocument(userId, "gstr-1-apr-2025.pdf", "pdf", gstr1),
    insertDocument(userId, "gstr-3b-apr-2025-a.pdf", "pdf", gstr3b),
    insertDocument(userId, "gstr-3b-apr-2025-b.pdf", "pdf", gstr3b),
  ];

  const reconciliation = await runReconciliation(userId, { documentIds, amountTolerance: 1, dateToleranceDays: 0 });
  const april = reconciliation.result.periods[0];

  assert.ok(april.exceptions.some((exception) => exception.code === "MULTIPLE_GSTR3B_FOR_PERIOD" && exception.rootField === "returnPeriod"));
  assert.equal(april.comparisons.length, 0);
  assert.equal(april.summary.totalChecks, 0);
  assert.equal(reconciliation.status, "needs_review");
});

test("never loads an unselected GSTIN-less return into reconciliation", async () => {
  const userId = crypto.randomUUID();
  const gstin = "29AABFB5678G1Z8";
  getDb().prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, "selection-isolation@example.test", "Selection Auditor", "test-only", new Date().toISOString());
  const selectedGstr1 = parseGstr1Text(`
    FORM GSTR-1 GSTIN ${gstin} Tax period April 2025
    B2B regular invoices 1 Invoice 1,000.00 0.00 90.00 90.00 0.00
    B2B reverse charge 0 Invoice 0.00 0.00 0.00 0.00 0.00
    Other outward-supply sections
  `, "selected-gstr1.pdf");
  const selectedGstr3b = parseGstr3bText(`
    FORM GSTR-3B GSTIN ${gstin} Period April 2025
    (a) Outward taxable supplies other than zero/nil/exempt 1,000.00 0.00 90.00 90.00 0.00
    (b) Outward taxable supplies - zero rated 0.00 0.00 - - 0.00
    (c) Other outward supplies - nil rated/exempt 0.00 - - - -
    (d) Inward supplies liable to reverse charge 0.00 0.00 0.00 0.00 0.00
    (e) Non-GST outward supplies 0.00 - - - -
  `, "selected-gstr3b.pdf");
  const unselectedGstr = parseGstr1Text(`
    FORM GSTR-1 Tax period April 2025
    B2B regular invoices 1 Invoice 9,999.00 0.00 899.91 899.91 0.00
    B2B reverse charge 0 Invoice 0.00 0.00 0.00 0.00 0.00
    Other outward-supply sections
  `, "unselected-gstinless-gstr1.pdf");
  const selectedIds = [
    insertDocument(userId, "selected-gstr1.pdf", "pdf", selectedGstr1),
    insertDocument(userId, "selected-gstr3b.pdf", "pdf", selectedGstr3b),
  ];
  const unselectedId = insertDocument(userId, "unselected-gstinless-gstr1.pdf", "pdf", unselectedGstr);

  const reconciliation = await runReconciliation(userId, { documentIds: selectedIds, amountTolerance: 1, dateToleranceDays: 0 });
  const resultDocumentIds = reconciliation.result.documents.map((document) => document.id);

  assert.deepEqual(new Set(reconciliation.documentIds), new Set(selectedIds));
  assert.deepEqual(new Set(resultDocumentIds), new Set(selectedIds));
  assert.ok(!resultDocumentIds.includes(unselectedId));
  assert.ok(!reconciliation.result.exceptions.some((exception) => exception.code === "MISSING_CLIENT_GSTIN"));
  assert.equal(reconciliation.result.periods.length, 1);
  assert.equal(reconciliation.result.periods[0].returnPeriod, "042025");
});

test("rejects a sales register selected with another client's GST returns", async () => {
  const userId = crypto.randomUUID();
  const booksGstin = "29AABFB5678G1Z8";
  const returnGstin = "24AEXPS3034H1Z6";
  getDb().prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, "cross-client-reconciliation@example.test", "Cross Client Auditor", "test-only", new Date().toISOString());
  const headers = ["Bill Date", "Bill No", "Party Name", "Assessable Amount"];
  const books = parseSalesRegisterMatrix([
    ["CLIENT A", `GSTIN ${booksGstin}`],
    headers,
    ["15/04/2025", "INV-1", "Buyer", 1000],
  ], "client-a-sales-register.xlsx");
  const gstr1 = parseGstr1Text(`
    FORM GSTR-1 GSTIN ${returnGstin} Tax period April 2025
    B2B regular invoices 1 Invoice 1,000.00 0.00 90.00 90.00 0.00
    B2B reverse charge 0 Invoice 0.00 0.00 0.00 0.00 0.00
    Other outward-supply sections
  `, "client-b-gstr1.pdf");
  const gstr3b = parseGstr3bText(`
    FORM GSTR-3B GSTIN ${returnGstin} Period April 2025
    (a) Outward taxable supplies other than zero/nil/exempt 1,000.00 0.00 90.00 90.00 0.00
    (b) Outward taxable supplies - zero rated 0.00 0.00 - - 0.00
    (c) Other outward supplies - nil rated/exempt 0.00 - - - -
    (d) Inward supplies liable to reverse charge 0.00 0.00 0.00 0.00 0.00
    (e) Non-GST outward supplies 0.00 - - - -
  `, "client-b-gstr3b.pdf");
  const documentIds = [
    insertDocument(userId, "client-a-sales-register.xlsx", "xlsx", books),
    insertDocument(userId, "client-b-gstr1.pdf", "pdf", gstr1),
    insertDocument(userId, "client-b-gstr3b.pdf", "pdf", gstr3b),
  ];

  await assert.rejects(
    runReconciliation(userId, { documentIds, amountTolerance: 1, dateToleranceDays: 0 }),
    (error) => {
      assert.equal(error.status, 422);
      assert.equal(error.code, "CLIENT_GSTIN_MISMATCH");
      assert.deepEqual(error.details.crossExamination.gstinGroups.map((group) => group.gstin), [booksGstin, returnGstin]);
      return true;
    },
  );
  assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM reconciliations WHERE user_id = ?").get(userId).count, 0);
});

test.after(() => {
  closeDb();
  fs.rmSync(testRoot, { recursive: true, force: true });
});
