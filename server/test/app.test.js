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
const { closeDb, getDb } = await import("../src/db/database.js");
const { parseUploadedFile } = await import("../src/sales_recon/parsers/index.js");

function fixture(relativePath) {
  return path.join(projectRoot, relativePath);
}

const sampleGstr1 = {
  gstin: "24AEXPS3034H1Z6",
  fp: "032026",
  b2b: [{ ctin: "24AAAAA0000A1Z5", inv: [{ inum: "INV-1001", idt: "05-03-2026", val: 118000, pos: "24", rchrg: "N", itms: [{ num: 1, itm_det: { txval: 100000, rt: 18, camt: 9000, samt: 9000, iamt: 0, csamt: 0 } }] }] }],
  b2cs: [{ pos: "27", rt: 18, txval: 25000, iamt: 4500, camt: 0, samt: 0, csamt: 0 }],
  exp: [{ exp_typ: "WOPAY", inv: [{ inum: "EXP-2001", idt: "14-03-2026", val: 50000, itms: [{ num: 1, itm_det: { txval: 50000, rt: 0, iamt: 0, csamt: 0 } }] }] }],
  cdnr: [{ ctin: "24AAAAA0000A1Z5", nt: [{ ntty: "C", nt_num: "CN-1", nt_dt: "20-03-2026", val: 11800, itms: [{ num: 1, itm_det: { txval: 10000, camt: 900, samt: 900, iamt: 0, csamt: 0 } }] }] }],
  nil: { inv: [{ sply_ty: "INTRB2C", nil_amt: 6000, expt_amt: 4000, ngsup_amt: 5000 }] },
};

const sampleGstr3b = {
  gstin: "24AEXPS3034H1Z6",
  ret_period: "032026",
  sup_details: {
    osup_det: { txval: 114500, iamt: 4500, camt: 8055, samt: 8055, csamt: 0 },
    osup_zero: { txval: 50000, iamt: 0, camt: 0, samt: 0, csamt: 0 },
    osup_nil_exmp: { txval: 10000, iamt: 0, camt: 0, samt: 0, csamt: 0 },
    isup_rev: { txval: 11640, iamt: 0, camt: 291, samt: 291, csamt: 0 },
    osup_nongst: { txval: 5000, iamt: 0, camt: 0, samt: 0, csamt: 0 },
  },
  inter_sup: { unreg_details: [{ pos: "27", txval: 25000, iamt: 4500 }] },
  itc_elg: { itc_avl: [{ ty: "OTH", iamt: 131323.25, camt: 112804.54, samt: 112804.54, csamt: 0 }] },
};

const unmappedLedger = "Ledger Ref,Party Label,Net Figure,Tax Figure\nL-1001,Northwind Components,125000,22500\nL-1002,Contoso Industrial,84000,15120\n";

test("universal router serves shared endpoints and protects sales routes", async (context) => {
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  for (const endpoint of ["auth/me", "sales/documents", "sales/document-org/missing", "sales/reconciliations"]) {
    const response = await fetch(`${base}/${endpoint}`);
    assert.equal(response.status, 401, endpoint);
    assert.equal((await response.json()).error.code, "AUTH_REQUIRED", endpoint);
  }

  const missing = await fetch(`${base}/unknown-service`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "NOT_FOUND");
});

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
  const apiBase = `http://127.0.0.1:${address.port}/api`;
  const base = `${apiBase}/sales`;

  async function register(email) {
    const response = await fetch(`${apiBase}/auth/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test Auditor", email, password: "auditor-pass-2026" }),
    });
    assert.equal(response.status, 201);
    return response.headers.get("set-cookie").split(";")[0];
  }
  const cookie = await register("primary@example.test");
  const form = new FormData();
  for (const [name, content, type] of [
    ["gstr1-march-2026.json", JSON.stringify(sampleGstr1), "application/json"],
    ["gstr3b-march-2026.json", JSON.stringify(sampleGstr3b), "application/json"],
    ["returns_R2B_24AEXPS3034H1Z6_032026.json", fs.readFileSync(fixture("docs/returns_R2B_24AEXPS3034H1Z6_032026.json")), "application/json"],
  ]) {
    form.append("files", new File([content], name, { type }));
  }
  const uploadResponse = await fetch(`${base}/documents/upload`, { method: "POST", headers: { cookie }, body: form });
  assert.equal(uploadResponse.status, 201);
  const uploaded = await uploadResponse.json();
  assert.equal(uploaded.documents.length, 3);
  assert.deepEqual(new Set(uploaded.documents.map((item) => item.documentType)), new Set(["gstr1", "gstr3b", "gstr2b"]));

  const invalidBulkGstinResponse = await fetch(`${base}/documents/gstin`, {
    method: "PUT", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ documentIds: uploaded.documents.map((item) => item.id), gstin: "BAD-GSTIN" }),
  });
  assert.equal(invalidBulkGstinResponse.status, 400);
  assert.equal((await invalidBulkGstinResponse.json()).error.code, "INVALID_GSTIN");

  const gstr1Document = uploaded.documents.find((item) => item.documentType === "gstr1");
  const originalGstr1Response = await fetch(`${base}/document-org/${gstr1Document.id}`, { headers: { cookie } });
  assert.equal(originalGstr1Response.status, 200);
  const originalGstr1 = (await originalGstr1Response.json()).document;
  assert.equal(originalGstr1.parsed, undefined);
  assert.ok(originalGstr1.original.fields.includes("cdnr.nt.ntty"));
  assert.ok(originalGstr1.original.fields.includes("cdnr.nt.nt_num"));
  assert.ok(originalGstr1.original.rows.some((row) => row["cdnr.nt.ntty"] === "C" && row["cdnr.nt.nt_num"] === "CN-1"));
  assert.deepEqual(
    JSON.parse(getDb().prepare("SELECT field_names FROM document_org WHERE document_id = ?").get(gstr1Document.id).field_names),
    originalGstr1.original.fields,
  );

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
  unmappedForm.append("files", new File([unmappedLedger], "unmapped-ledger.csv", { type: "text/csv" }));
  const unmappedUploadResponse = await fetch(`${base}/documents/upload`, { method: "POST", headers: { cookie }, body: unmappedForm });
  assert.equal(unmappedUploadResponse.status, 201);
  const unmappedUpload = await unmappedUploadResponse.json();
  const unmappedId = unmappedUpload.documents[0].id;
  assert.equal(unmappedUpload.documents[0].status, "needs_mapping");
  assert.equal(unmappedUpload.documents[0].mappingCoverage.viewMode, "prompt");
  assert.deepEqual(unmappedUpload.documents[0].parsed.sourceFields, ["Ledger Ref", "Party Label", "Net Figure", "Tax Figure"]);

  const bulkGstinResponse = await fetch(`${base}/documents/gstin`, {
    method: "PUT", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ documentIds: [unmappedId], gstin: "24aexps3034h1z6" }),
  });
  assert.equal(bulkGstinResponse.status, 200);
  const bulkGstin = await bulkGstinResponse.json();
  assert.equal(bulkGstin.documents.length, 1);
  assert.equal(bulkGstin.documents[0].gstin, "24AEXPS3034H1Z6");

  const unmappedOriginalResponse = await fetch(`${base}/document-org/${unmappedId}`, { headers: { cookie } });
  assert.equal(unmappedOriginalResponse.status, 200);
  const unmappedOriginal = (await unmappedOriginalResponse.json()).document;
  assert.deepEqual(unmappedOriginal.original.fields, ["Ledger Ref", "Party Label", "Net Figure", "Tax Figure"]);
  assert.equal(unmappedOriginal.original.rows[0]["Ledger Ref"], "L-1001");

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
  const exportQuery = "gstin=24AEXPS3034H1Z6&year=2026";
  const exportDataResponse = await fetch(`${base}/reconciliations/export-data?${exportQuery}`, { headers: { cookie } });
  assert.equal(exportDataResponse.status, 200);
  const { exportData } = await exportDataResponse.json();
  assert.ok(exportData.rows.length > 0);
  assert.equal((await fetch(`${base}/reconciliations/export-data?${exportQuery}`, { headers: { cookie: otherCookie } })).status, 404);

  const exportResponse = await fetch(`${base}/reconciliations/export`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ gstin: exportData.clientGstin, year: "2026", rows: [{ id: exportData.rows[0].id, value: 42 }] }),
  });
  assert.equal(exportResponse.status, 200);
  assert.equal(exportResponse.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const workbook = new Uint8Array(await exportResponse.arrayBuffer());
  assert.deepEqual([...workbook.slice(0, 2)], [0x50, 0x4b]);

  const invalidAmendment = await fetch(`${base}/reconciliations/export`, {
    method: "POST", headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ gstin: exportData.clientGstin, year: "2026", rows: [{ id: "unowned-cell", value: 42 }] }),
  });
  assert.equal(invalidAmendment.status, 400);
  assert.equal((await invalidAmendment.json()).error.code, "INVALID_EXPORT_AMENDMENT");

  const otherList = await fetch(`${base}/documents`, { headers: { cookie: otherCookie } });
  assert.equal(otherList.status, 200);
  assert.equal((await otherList.json()).documents.length, 0);
  assert.equal((await fetch(`${base}/document-org/${gstr1Document.id}`, { headers: { cookie: otherCookie } })).status, 404);
  assert.equal((await fetch(`${base}/reconciliations/${reconciliation.id}`, { method: "DELETE", headers: { cookie: otherCookie } })).status, 404);

  const reconciliationListBeforeDelete = await fetch(`${base}/reconciliations`, { headers: { cookie } });
  assert.equal(reconciliationListBeforeDelete.status, 200);
  assert.ok((await reconciliationListBeforeDelete.json()).reconciliations.some((item) => item.id === reconciliation.id));
  assert.equal((await fetch(`${base}/reconciliations/${reconciliation.id}`, { method: "DELETE", headers: { cookie } })).status, 204);
  assert.equal((await fetch(`${base}/reconciliations/${reconciliation.id}`, { headers: { cookie } })).status, 404);

  const storedFilesBeforeDelete = fs.readdirSync(process.env.GST_UPLOAD_DIR);
  const otherDeleteResponse = await fetch(`${base}/documents/${unmappedId}`, { method: "DELETE", headers: { cookie: otherCookie } });
  assert.equal(otherDeleteResponse.status, 404);
  assert.deepEqual(fs.readdirSync(process.env.GST_UPLOAD_DIR), storedFilesBeforeDelete);

  const deleteResponse = await fetch(`${base}/documents/${unmappedId}`, { method: "DELETE", headers: { cookie } });
  assert.equal(deleteResponse.status, 204);
  assert.equal((await fetch(`${base}/documents/${unmappedId}`, { headers: { cookie } })).status, 404);
  assert.equal(getDb().prepare("SELECT document_id FROM document_org WHERE document_id = ?").get(unmappedId), undefined);
  assert.equal(fs.readdirSync(process.env.GST_UPLOAD_DIR).length, storedFilesBeforeDelete.length - 1);

  const bulkIds = uploaded.documents.slice(0, 2).map((document) => document.id);
  const otherBulkDelete = await fetch(`${base}/documents`, {
    method: "DELETE", headers: { cookie: otherCookie, "content-type": "application/json" }, body: JSON.stringify({ documentIds: bulkIds }),
  });
  assert.equal(otherBulkDelete.status, 404);
  assert.equal((await fetch(`${base}/documents`, { headers: { cookie } }).then((response) => response.json())).documents.length, 3);

  const storedFilesBeforeBulkDelete = fs.readdirSync(process.env.GST_UPLOAD_DIR);
  const bulkDeleteResponse = await fetch(`${base}/documents`, {
    method: "DELETE", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ documentIds: bulkIds }),
  });
  assert.equal(bulkDeleteResponse.status, 200);
  const bulkDelete = await bulkDeleteResponse.json();
  assert.deepEqual(new Set(bulkDelete.deletedIds), new Set(bulkIds));
  assert.deepEqual(bulkDelete.errors, []);
  assert.equal((await fetch(`${base}/documents`, { headers: { cookie } }).then((response) => response.json())).documents.length, 1);
  assert.equal(fs.readdirSync(process.env.GST_UPLOAD_DIR).length, storedFilesBeforeBulkDelete.length - 2);
});

test.after(() => {
  closeDb();
  fs.rmSync(testRoot, { recursive: true, force: true });
});
