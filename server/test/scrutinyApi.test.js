import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import { unzipSync } from "fflate";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scrutiny-api-"));
process.env.NODE_ENV = "test";
process.env.GST_DATA_DIR = testRoot;
process.env.GST_DATABASE_PATH = path.join(testRoot, "test.sqlite");
process.env.GST_UPLOAD_DIR = path.join(testRoot, "sales-uploads");
process.env.AUDIT_UPLOAD_DIR = path.join(testRoot, "audit-uploads");

const { createApp } = await import("../src/app.js");
const { config } = await import("../src/config.js");
const { closeDb, getDb } = await import("../src/db/database.js");
const { validateScrutinyResponse } = await import("../src/scrutiny/api/validators.js");

async function launch(context) {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(async () => { await new Promise((resolve) => server.close(resolve)); closeDb();
    fs.rmSync(testRoot, { recursive: true, force: true }); });
  return `http://127.0.0.1:${server.address().port}/api`;
}

async function register(api, email) {
  const response = await fetch(`${api}/auth/register`, { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Audit Tester", email, password: "safe-password-2026" }) });
  assert.equal(response.status, 201);
  return response.headers.get("set-cookie").split(";")[0];
}

async function request(url, cookie, method = "GET", body) {
  const response = await fetch(url, { method, headers: { cookie,
    ...(body === undefined ? {} : { "content-type": "application/json" }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, payload: await response.json() };
}

async function upload(base, cookie, role, records, extra = {}) {
  const form = new FormData();
  form.append("role", role);
  form.append("completeExport", extra.completeExport === false ? "false" : "true");
  form.append("file", new File([JSON.stringify({ records, completeExport: true,
    ...(extra.financialYear ? { financialYear: extra.financialYear } : {}) })],
  `${role}.json`, { type: "application/json" }));
  const response = await fetch(`${base}/sources`, { method: "POST", headers: { cookie }, body: form });
  return { response, payload: await response.json() };
}

test("scrutiny API persists selected-source runs, evidence, reviews and user isolation", async (context) => {
  const api = await launch(context);
  const alice = await register(api, "audit-alice@example.test");
  const bob = await register(api, "audit-bob@example.test");
  const { response: created, payload: createdBody } = await request(`${api}/scrutiny/audit-reports`, alice, "POST", {
    name: "FY 2025 scrutiny", taxpayerId: "ABCDE1234F", fiscalYear: "2025-2026",
  });
  assert.equal(created.status, 201);
  validateScrutinyResponse("createAuditReport", createdBody);
  const base = `${api}/scrutiny/audit-reports/${createdBody.auditReport.id}`;
  const { response: hidden } = await request(base, bob);
  assert.equal(hidden.status, 404);

  const books = await upload(base, alice, "books_vouchers", [
    { voucherId: "V1", postings: [
      { ledger: "Bank", side: "debit", amount: "100.00" },
      { ledger: "Revenue", side: "credit", amount: "100.00", incomeAmount: "100.00",
        incomeCategory: "INTEREST", taxpayerId: "ABCDE1234F", period: "2025-04", reference: "R1" },
    ] },
  ]);
  assert.equal(books.response.status, 201);
  validateScrutinyResponse("uploadAuditSource", books.payload);
  assert.equal(books.payload.source.parseStatus, "ready");
  const storedBooks = getDb().prepare("SELECT parsed_json FROM scrutiny_sources WHERE id = ?")
    .get(books.payload.source.id);
  assert.equal(JSON.parse(storedBooks.parsed_json).records, undefined);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM scrutiny_source_records WHERE source_id = ? AND collection = 'records'")
    .get(books.payload.source.id).count, 2);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM scrutiny_source_records WHERE source_id = ? AND collection = 'rawRows'")
    .get(books.payload.source.id).count, 2);
  const { payload: bookDetail } = await request(`${base}/sources/${books.payload.source.id}`, alice);
  assert.equal(bookDetail.source.parsed.records.length, 2);
  validateScrutinyResponse("getAuditSource", bookDetail);
  const rawPage = await request(`${base}/sources/${books.payload.source.id}/rows?collection=rawRows&limit=1`, alice);
  assert.equal(rawPage.payload.total, 2);
  assert.equal(rawPage.payload.rows.length, 1);
  const preflight = await request(`${base}/sources/${books.payload.source.id}/preflight`, alice);
  validateScrutinyResponse("sourcePreflight", preflight.payload);
  const ledgers = await upload(base, alice, "books_ledgers", [
    { ledger: "Bank", openingBalance: "0.00", debits: "100.00", credits: "0.00", closingBalance: "100.00" },
    { ledger: "Revenue", openingBalance: "0.00", debits: "0.00", credits: "100.00", closingBalance: "-100.00" },
  ]);
  assert.equal(ledgers.response.status, 201);
  const trial = await upload(base, alice, "trial_balance", [
    { ledger: "Bank", openingDebit: "0.00", openingCredit: "0.00", closingDebit: "100.00", closingCredit: "0.00" },
    { ledger: "Revenue", openingDebit: "0.00", openingCredit: "0.00", closingDebit: "0.00", closingCredit: "100.00" },
  ]);
  assert.equal(trial.response.status, 201);
  const prior = await upload(base, alice, "prior_year_trial_balance", [
    { ledger: "Bank", openingDebit: "0.00", openingCredit: "0.00", closingDebit: "0.00", closingCredit: "0.00" },
    { ledger: "Revenue", openingDebit: "0.00", openingCredit: "0.00", closingDebit: "0.00", closingCredit: "0.00" },
  ]);
  assert.equal(prior.response.status, 201);
  const ais = await upload(base, alice, "ais", [
    { taxpayerId: "ABCDE1234F", category: "INTEREST", period: "2025-04", reference: "R1", amount: "99.00" },
  ]);
  assert.equal(ais.response.status, 201);

  const sourceIds = [books, ledgers, trial, prior, ais].map((item) => item.payload.source.id);
  const checks = ["B01", "B02", "B03", "B04", "P01", "AIS01", "AIS02"];
  const { response: started, payload: startedBody } = await request(`${base}/runs`, alice, "POST", {
    selectedSourceIds: sourceIds, checkIds: checks, idempotencyKey: "full-run-1",
  });
  assert.equal(started.status, 202);
  validateScrutinyResponse("createAuditRun", startedBody);
  const runId = startedBody.run.id;
  let run;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    ({ payload: { run } } = await request(`${base}/runs/${runId}`, alice));
    if (["completed", "failed"].includes(run.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(run.status, "completed", JSON.stringify(run.error));
  validateScrutinyResponse("getAuditRun", { run });
  const { payload: resultBody } = await request(`${base}/runs/${runId}/results`, alice);
  validateScrutinyResponse("listAuditResults", resultBody);
  const comparisons = await request(`${base}/runs/${runId}/comparisons?limit=2`, alice);
  validateScrutinyResponse("comparisonRows", comparisons.payload);
  assert.ok(comparisons.payload.rows.length <= 2);
  assert.deepEqual(resultBody.results.map((item) => item.status), [
    "matched", "matched", "matched", "matched", "matched", "difference", "insufficient_data",
  ]);
  assert.deepEqual(resultBody.results.map((item) => item.checkId), checks);
  const exportBase = `${api}/scrutiny/audit-reports/exports`;
  const createExport = async (format, grouping) => {
    const response = await request(exportBase, alice, "POST", { runIds: [runId], format, grouping });
    assert.equal(response.response.status, 202);
    validateScrutinyResponse("auditExport", response.payload);
    let job = response.payload.export;
    for (let attempt = 0; attempt < 40 && !["completed", "failed"].includes(job.status); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      ({ payload: { export: job } } = await request(`${exportBase}/${job.id}`, alice));
    }
    assert.equal(job.status, "completed", JSON.stringify(job.error));
    assert.equal((await fetch(`${exportBase}/${job.id}/file`, { headers: { cookie: bob } })).status, 404);
    const file = await fetch(`${exportBase}/${job.id}/file`, { headers: { cookie: alice } });
    assert.equal(file.status, 200);
    return Buffer.from(await file.arrayBuffer());
  };
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await createExport("xlsx", "consolidated"));
  assert.equal(workbook.getWorksheet("Summary").getRow(2).getCell(4).value, "B01");
  assert.equal(workbook.getWorksheet("Comparisons").getRow(2).getCell(2).value, "B01");
  const savedComparison = resultBody.results.find((item) => item.checkId === "AIS01").evidence[0];
  const exportedComparison = workbook.getWorksheet("Comparisons").getRows(2,
    workbook.getWorksheet("Comparisons").rowCount - 1).find((row) => row.getCell(2).value === "AIS01");
  assert.equal(exportedComparison.getCell(6).value, savedComparison.expectedAmount);
  assert.equal(exportedComparison.getCell(7).value, savedComparison.actualAmount);
  assert.deepEqual(JSON.parse(exportedComparison.getCell(11).value), savedComparison.sourceRefs);
  assert.deepEqual(JSON.parse(exportedComparison.getCell(12).value), savedComparison);
  const pdfBytes = await createExport("pdf", "consolidated");
  assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");
  const pdfTask = getDocument({ data: new Uint8Array(pdfBytes) });
  const pdfDocument = await pdfTask.promise;
  const pdfText = [];
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const pdfPage = await pdfDocument.getPage(pageNumber);
    pdfText.push((await pdfPage.getTextContent()).items.map((item) => item.str).join(" "));
  }
  assert.match(pdfText.join(" "), /B01/);
  assert.match(pdfText.join(" "), /99\.00/);
  assert.match(pdfText.join(" "), new RegExp(ais.payload.source.id.replaceAll("-", "-\\s*")));
  await pdfTask.destroy();
  const archive = unzipSync(await createExport("xlsx", "by_fy"));
  assert.ok(Object.keys(archive).includes("scrutiny-2025-2026.xlsx"));
  const separateWorkbook = new ExcelJS.Workbook();
  await separateWorkbook.xlsx.load(Buffer.from(archive["scrutiny-2025-2026.xlsx"]));
  assert.equal(separateWorkbook.getWorksheet("Summary").getRow(2).getCell(4).value, "B01");
  const profileBase = `${api}/scrutiny/audit-reports/mapping-profiles`;
  const profileCreated = await request(profileBase, alice, "POST", { name: "Common books",
    role: "books_ledgers", configuration: { fields: {}, accountRoles: { Revenue: "sales" } } });
  assert.equal(profileCreated.response.status, 201);
  validateScrutinyResponse("auditProfile", profileCreated.payload);
  const profileId = profileCreated.payload.profile.id;
  assert.equal(profileCreated.payload.profile.status, "pending");
  assert.equal((await request(`${profileBase}/${profileId}/approve`, bob, "POST")).response.status, 404);
  assert.equal((await request(`${profileBase}/${profileId}/approve`, alice, "POST")).payload.profile.status, "approved");
  const derived = await request(`${base}/sources/derive`, alice, "POST", {
    fromSourceId: ledgers.payload.source.id, profileId, completeExport: true });
  assert.equal(derived.response.status, 201, JSON.stringify(derived.payload));
  const derivedDetail = await request(`${base}/sources/${derived.payload.source.id}`, alice);
  assert.equal(derivedDetail.payload.source.parsed.records.find((row) => row.ledger === "Revenue").accountRole, "sales");
  assert.equal((await request(`${base}/sources/${ledgers.payload.source.id}`, alice)).payload.source.parsed.records[1].accountRole, undefined);
  const anotherLedger = await upload(base, alice, "books_ledgers", [
    { ledger: "Revenue", openingBalance: "0.00", debits: "0.00", credits: "25.00", closingBalance: "25.00" },
  ]);
  const reusedProfile = await request(`${base}/sources/derive`, alice, "POST", {
    fromSourceId: anotherLedger.payload.source.id, profileId, completeExport: true });
  assert.equal(reusedProfile.response.status, 201);
  assert.equal((await request(`${base}/sources/${reusedProfile.payload.source.id}`, alice))
    .payload.source.parsed.records[0].accountRole, "sales");
  const nextProfileVersion = await request(profileBase, alice, "POST", { name: "Common books",
    role: "books_ledgers", configuration: { fields: {}, accountRoles: { Revenue: "business_receipts" } } });
  assert.equal(nextProfileVersion.payload.profile.version, 2);
  assert.equal((await request(`${base}/sources/${derived.payload.source.id}`, alice))
    .payload.source.parsed.records.find((row) => row.ledger === "Revenue").accountRole, "sales");
  const { response: reviewResponse, payload: reviewBody } = await request(
    `${base}/runs/${runId}/results/B04/decision`, alice, "PUT",
    { decision: "confirmed", note: "No dormant balances" });
  assert.equal(reviewResponse.status, 200);
  validateScrutinyResponse("reviewAuditResult", reviewBody);
  assert.equal(reviewBody.review.resultId, "B04");
  const reviewed = await request(`${base}/runs/${runId}/results`, alice);
  assert.equal(reviewed.payload.reviews.length, 1);
  assert.equal((await request(`${base}/runs/${runId}/results`, bob)).response.status, 404);

  const sameRun = await request(`${base}/runs`, alice, "POST", {
    selectedSourceIds: sourceIds, checkIds: checks, idempotencyKey: "full-run-1",
  });
  assert.equal(sameRun.payload.run.id, runId);
  const original = await fetch(`${base}/sources/${books.payload.source.id}/file`, { headers: { cookie: alice } });
  assert.equal(original.status, 200);
  assert.match(await original.text(), /"voucherId":"V1"/);
  assert.equal((await fetch(`${base}/sources/${books.payload.source.id}/file`,
    { headers: { cookie: bob } })).status, 404);

  const wrongTaxpayer = await upload(base, alice, "ais", [
    { taxpayerId: "PQRST1234F", category: "INTEREST", period: "2025-04", reference: "R1", amount: "100.00" },
  ]);
  assert.equal(wrongTaxpayer.response.status, 201);
  assert.equal(wrongTaxpayer.payload.source.parseStatus, "insufficient_data");
  assert.ok(wrongTaxpayer.payload.source.issues.some((issue) => issue.code === "AUDIT_TAXPAYER_MISMATCH"));
  const wrongYear = await upload(base, alice, "ais", [
    { taxpayerId: "ABCDE1234F", category: "INTEREST", period: "2025-04", reference: "R1", amount: "100.00" },
  ], { financialYear: "2024-2025" });
  assert.equal(wrongYear.response.status, 201);
  assert.equal(wrongYear.payload.source.parseStatus, "insufficient_data");
  assert.ok(wrongYear.payload.source.issues.some((issue) => issue.code === "AUDIT_PERIOD_MISMATCH"));
  const incomplete = await upload(base, alice, "books_vouchers", [
    { voucherId: "V2", ledger: "Bank", side: "debit", amount: "1.00" },
  ], { completeExport: false });
  assert.equal(incomplete.payload.source.parseStatus, "insufficient_data");
  const previousStorageLimit = config.maxAuditUserStorageBytes;
  config.maxAuditUserStorageBytes = 1;
  try {
    const overStorage = await upload(base, alice, "books_vouchers", [
      { voucherId: "V3", ledger: "Bank", side: "debit", amount: "1.00" },
    ]);
    assert.equal(overStorage.response.status, 413);
    assert.equal(overStorage.payload.error.code, "AUDIT_STORAGE_LIMIT_EXCEEDED");
  } finally {
    config.maxAuditUserStorageBytes = previousStorageLimit;
  }
  const incompleteRun = await request(`${base}/runs`, alice, "POST", {
    selectedSourceIds: [incomplete.payload.source.id], checkIds: ["B01"],
  });
  assert.equal(incompleteRun.response.status, 202);
  let incompleteResult;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    ({ payload: { run: incompleteResult } } = await request(
      `${base}/runs/${incompleteRun.payload.run.id}`, alice));
    if (["completed", "failed"].includes(incompleteResult.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(incompleteResult.results[0].status, "review");
  assert(incompleteResult.results[0].evidence.some((row) => row.kind === "source_limitation"));
  const partialLedger = await upload(base, alice, "books_ledgers", [
    { ledger: "Dormant", openingBalance: "10.00", debits: "0.00", credits: "0.00", closingBalance: "10.00" },
    { ledger: "Unassessable", debits: "1.00", credits: "0.00" },
  ], { completeExport: false });
  assert.equal(partialLedger.payload.source.parseStatus, "insufficient_data");
  const partialRun = await request(`${base}/runs`, alice, "POST", {
    selectedSourceIds: [partialLedger.payload.source.id], checkIds: ["B04"],
  });
  assert.equal(partialRun.response.status, 202);
  let partialResult;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    ({ payload: { run: partialResult } } = await request(`${base}/runs/${partialRun.payload.run.id}`, alice));
    if (["completed", "failed"].includes(partialResult.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(partialResult.status, "completed");
  assert.equal(partialResult.results[0].status, "review");
  assert(partialResult.results[0].evidence.some((row) => row.ledger === "Dormant"));
  assert(partialResult.results[0].evidence.some((row) => row.kind === "unassessable_ledger"));

  // Simulate a previously saved paired-column source whose zero controls may
  // have been inferred by the older importer. Its historical run stays fixed,
  // while a new balance-based run must request a corrected source revision.
  const legacyRecord = getDb().prepare(`SELECT record_json FROM scrutiny_source_records
    WHERE source_id = ? AND collection = 'records' AND ordinal = 0`).get(ledgers.payload.source.id);
  const legacyValue = JSON.parse(legacyRecord.record_json);
  legacyValue.entries = [{ side: "debit", amount: "100.00", details: [], date: "01/04/2025" }];
  getDb().prepare(`UPDATE scrutiny_source_records SET record_json = ?
    WHERE source_id = ? AND collection = 'records' AND ordinal = 0`)
    .run(JSON.stringify(legacyValue), ledgers.payload.source.id);
  getDb().prepare("UPDATE scrutiny_sources SET parser_version = '3' WHERE id = ?")
    .run(ledgers.payload.source.id);
  const legacyDetail = await request(`${base}/sources/${ledgers.payload.source.id}`, alice);
  assert.ok(legacyDetail.payload.source.parsed.issues.some((issue) => issue.code === "AUDIT_LEGACY_BALANCE_INFERENCE"));
  const legacyRun = await request(`${base}/runs`, alice, "POST", {
    selectedSourceIds: [ledgers.payload.source.id], checkIds: ["B02", "B06"],
  });
  let legacyResult;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    ({ payload: { run: legacyResult } } = await request(`${base}/runs/${legacyRun.payload.run.id}`, alice));
    if (["completed", "failed"].includes(legacyResult.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(legacyResult.status, "completed");
  assert.deepEqual(legacyResult.results.map((row) => row.status), ["insufficient_data", "insufficient_data"]);
  assert.equal((await request(`${base}/runs/${runId}`, alice)).payload.run.results
    .find((row) => row.checkId === "B02").status, "matched");

  const mixed = await request(`${base}/runs`, alice, "POST", {
    selectedSourceIds: [books.payload.source.id, "foreign-source"], checkIds: ["B01"],
  });
  assert.equal(mixed.response.status, 400);
  assert.equal(mixed.payload.error.code, "INVALID_AUDIT_SELECTION");
});
