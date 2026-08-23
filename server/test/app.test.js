import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gst-recon-test-"));
process.env.NODE_ENV = "test";
process.env.GST_DATA_DIR = testRoot;
process.env.GST_DATABASE_PATH = path.join(testRoot, "test.sqlite");
process.env.GST_UPLOAD_DIR = path.join(testRoot, "uploads");

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { createApp } = await import("../src/app.js");
const { closeDb } = await import("../src/db/database.js");
const { parseUploadedFile } = await import("../src/parsers/index.js");

function fixture(relativePath) {
  return path.join(projectRoot, relativePath);
}

test("provided GST JSON is recognized and normalized as GSTR-2B", async () => {
  const parsed = await parseUploadedFile(fixture("docs/returns_R2B_24AEXPS3034H1Z6_032026.json"), "returns_R2B_24AEXPS3034H1Z6_032026.json", "application/json");
  assert.equal(parsed.fileType, "json");
  assert.equal(parsed.documentType, "gstr2b");
  assert.equal(parsed.gstin, "24AEXPS3034H1Z6");
  assert.equal(parsed.returnPeriod, "032026");
  assert.ok(parsed.rows.length > 30);
  assert.ok(parsed.summary.itcAvailable.igst > 100000);
});

test("authenticated API isolates documents and runs the full three-return flow", async (context) => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/api`;

  async function register(email) {
    const response = await fetch(`${base}/auth/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test Auditor", email, password: "auditor-pass-2026" }),
    });
    assert.equal(response.status, 201);
    return response.headers.get("set-cookie").split(";")[0];
  }
  const cookie = await register("primary@example.test");
  const form = new FormData();
  for (const [relativePath, type] of [
    ["sample-docs/gstr1-march-2026.json", "application/json"],
    ["sample-docs/gstr3b-march-2026.json", "application/json"],
    ["docs/returns_R2B_24AEXPS3034H1Z6_032026.json", "application/json"],
  ]) {
    const source = fixture(relativePath);
    form.append("files", new File([fs.readFileSync(source)], path.basename(source), { type }));
  }
  const uploadResponse = await fetch(`${base}/documents/upload`, { method: "POST", headers: { cookie }, body: form });
  assert.equal(uploadResponse.status, 201);
  const uploaded = await uploadResponse.json();
  assert.equal(uploaded.documents.length, 3);
  assert.deepEqual(new Set(uploaded.documents.map((item) => item.documentType)), new Set(["gstr1", "gstr3b", "gstr2b"]));

  const runResponse = await fetch(`${base}/reconciliations`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ documentIds: uploaded.documents.map((item) => item.id), amountTolerance: 1, dateToleranceDays: 0 }),
  });
  assert.equal(runResponse.status, 201);
  const { reconciliation } = await runResponse.json();
  assert.equal(reconciliation.status, "needs_review");
  assert.equal(reconciliation.result.summary.mismatched, 3);
  assert.equal(reconciliation.result.summary.totalChecks, 23);
  assert.equal(reconciliation.result.comparisons.filter((item) => item.table === "3.2" && item.status === "matched").length, 2);
  assert.equal(reconciliation.result.comparisons.filter((item) => item.table === "3.1(d)" && item.status === "matched").length, 5);
  assert.equal(reconciliation.result.comparisons.filter((item) => item.kind === "itc" && item.status === "matched").length, 4);
  assert.ok(reconciliation.result.suggestions.some((item) => item.includes("GSTR-1 is higher")));

  const unmappedForm = new FormData();
  const unmappedSource = fixture("sample-docs/unmapped-ledger.csv");
  unmappedForm.append("files", new File([fs.readFileSync(unmappedSource)], path.basename(unmappedSource), { type: "text/csv" }));
  const unmappedUploadResponse = await fetch(`${base}/documents/upload`, { method: "POST", headers: { cookie }, body: unmappedForm });
  assert.equal(unmappedUploadResponse.status, 201);
  const unmappedUpload = await unmappedUploadResponse.json();
  const unmappedId = unmappedUpload.documents[0].id;
  assert.equal(unmappedUpload.documents[0].status, "needs_mapping");
  assert.equal(unmappedUpload.documents[0].mappingCoverage.viewMode, "prompt");
  assert.deepEqual(unmappedUpload.documents[0].parsed.sourceFields, ["Ledger Ref", "Party Label", "Net Figure", "Tax Figure"]);

  const originalResponse = await fetch(`${base}/documents/${unmappedId}/view-preference`, {
    method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ mode: "original" }),
  });
  assert.equal(originalResponse.status, 200);
  assert.equal((await originalResponse.json()).document.mappingCoverage.viewMode, "original");
  const hiddenResponse = await fetch(`${base}/documents/${unmappedId}/view-preference`, {
    method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ mode: "hidden" }),
  });
  assert.equal(hiddenResponse.status, 200);
  assert.equal((await hiddenResponse.json()).document.mappingCoverage.viewMode, "hidden");

  const otherCookie = await register("other@example.test");
  const otherList = await fetch(`${base}/documents`, { headers: { cookie: otherCookie } });
  assert.equal(otherList.status, 200);
  assert.equal((await otherList.json()).documents.length, 0);
});

test.after(() => {
  closeDb();
  fs.rmSync(testRoot, { recursive: true, force: true });
});
