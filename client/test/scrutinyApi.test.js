import assert from "node:assert/strict";
import test from "node:test";
import { api } from "../src/api/client.js";
import { AUDIT_CHECKS, buildReportRequest, buildRunRequest, buildSourceUploadForm, isTerminalRun, latestReviewFor, parsedFields, parsedRows, scrutinyApi } from "../src/api/scrutiny.js";

test("scrutiny request builders preserve the public API fields", () => {
  assert.deepEqual(AUDIT_CHECKS.map(([id]) => id), ["B01", "B02", "B03", "B04", "P01", "AIS01", "AIS02"]);
  assert.deepEqual(buildReportRequest({ name: "  Annual audit ", fiscalYear: " 2024-2025 ", taxpayerId: " ab123 " }), {
    name: "Annual audit", fiscalYear: "2024-2025", taxpayerId: "AB123",
  });
  assert.deepEqual(buildReportRequest({ name: "Audit", fiscalYear: "2024-2025", taxpayerId: " " }), {
    name: "Audit", fiscalYear: "2024-2025",
  });
  const request = buildRunRequest(["source-1"], ["B01", "AIS01"]);
  assert.deepEqual(request.selectedSourceIds, ["source-1"]);
  assert.deepEqual(request.checkIds, ["B01", "AIS01"]);
  assert.equal(Object.keys(request).every((key) => ["selectedSourceIds", "checkIds", "idempotencyKey"].includes(key)), true);
});

test("source upload uses one file and explicit completeness metadata", () => {
  const file = new Blob(["a,b\n1,2"], { type: "text/csv" });
  const form = buildSourceUploadForm(file, "books_vouchers", false);
  assert.equal(form.getAll("file").length, 1);
  assert.equal(form.get("role"), "books_vouchers");
  assert.equal(form.get("completeExport"), "false");
  assert.equal(buildSourceUploadForm(file, "ais", true).get("completeExport"), "true");
});

test("parsed rows expose heterogeneous columns and run terminal states", () => {
  const parsed = { records: [{ a: 1 }, { b: "two" }, null] };
  assert.deepEqual(parsedRows(parsed), [{ a: 1 }, { b: "two" }, { value: null }]);
  assert.deepEqual(parsedFields(parsed), ["a", "b", "value"]);
  assert.equal(isTerminalRun("completed"), true);
  assert.equal(isTerminalRun("failed"), true);
  assert.equal(isTerminalRun("running"), false);
});

test("review history resolves the latest event for each finding", () => {
  const reviews = [
    { resultId: "one", decision: "confirmed", createdAt: "2026-09-22T10:00:00.000Z" },
    { resultId: "two", decision: "dismissed", createdAt: "2026-09-22T11:00:00.000Z" },
    { resultId: "one", decision: "needs_follow_up", createdAt: "2026-09-22T12:00:00.000Z" },
  ];
  assert.equal(latestReviewFor(reviews, "one")?.decision, "needs_follow_up");
  assert.equal(latestReviewFor([...reviews].reverse(), "one")?.decision, "needs_follow_up");
  assert.equal(latestReviewFor(reviews, "missing"), null);
});

test("scrutiny endpoints use the authenticated shared API client and nested paths", async () => {
  const originalAdapter = api.defaults.adapter;
  const requests = [];
  api.defaults.adapter = async (config) => {
    requests.push(config);
    return { data: { ok: true }, status: 200, statusText: "OK", headers: {}, config };
  };
  try {
    await scrutinyApi.listReports();
    await scrutinyApi.getReport("report/1");
    await scrutinyApi.getSource("report/1", "source/2");
    await scrutinyApi.getSourceFile("report/1", "source/2");
    await scrutinyApi.createRun("report/1", ["source/2"], ["B01"]);
    await scrutinyApi.getRun("report/1", "run/3");
    await scrutinyApi.getResults("report/1", "run/3");
    await scrutinyApi.setDecision("report/1", "run/3", "result/4", "confirmed", "  Checked  ");
  } finally {
    api.defaults.adapter = originalAdapter;
  }
  assert.equal(api.defaults.baseURL, "/api");
  assert.equal(api.defaults.withCredentials, true);
  assert.deepEqual(requests.map(({ method, url }) => `${method.toUpperCase()} ${url}`), [
    "GET /scrutiny/audit-reports",
    "GET /scrutiny/audit-reports/report%2F1",
    "GET /scrutiny/audit-reports/report%2F1/sources/source%2F2",
    "GET /scrutiny/audit-reports/report%2F1/sources/source%2F2/file",
    "POST /scrutiny/audit-reports/report%2F1/runs",
    "GET /scrutiny/audit-reports/report%2F1/runs/run%2F3",
    "GET /scrutiny/audit-reports/report%2F1/runs/run%2F3/results",
    "PUT /scrutiny/audit-reports/report%2F1/runs/run%2F3/results/result%2F4/decision",
  ]);
  assert.equal(requests[3].responseType, "blob");
  assert.deepEqual(JSON.parse(requests[7].data), { decision: "confirmed", note: "Checked" });
});
