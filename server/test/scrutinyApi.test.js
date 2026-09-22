import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scrutiny-api-"));
process.env.NODE_ENV = "test";
process.env.GST_DATA_DIR = testRoot;
process.env.GST_DATABASE_PATH = path.join(testRoot, "test.sqlite");
process.env.GST_UPLOAD_DIR = path.join(testRoot, "sales-uploads");
process.env.AUDIT_UPLOAD_DIR = path.join(testRoot, "audit-uploads");

const { createApp } = await import("../src/app.js");
const { closeDb } = await import("../src/db/database.js");
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
    { taxpayerId: "ABCDE1234F", category: "INTEREST", period: "2025-04", reference: "R1", amount: "100.00" },
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
  assert.deepEqual(resultBody.results.map((item) => item.status), [
    "matched", "matched", "matched", "matched", "matched", "matched", "insufficient_data",
  ]);
  assert.deepEqual(resultBody.results.map((item) => item.checkId), checks);
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
  assert.equal(incompleteResult.results[0].status, "insufficient_data");
  const mixed = await request(`${base}/runs`, alice, "POST", {
    selectedSourceIds: [books.payload.source.id, "foreign-source"], checkIds: ["B01"],
  });
  assert.equal(mixed.response.status, 400);
  assert.equal(mixed.payload.error.code, "INVALID_AUDIT_SELECTION");
});
