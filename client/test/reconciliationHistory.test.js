import assert from "node:assert/strict";
import test from "node:test";
import { buildYearReconciliation, indexReconciliationHistory } from "../src/utils/reconciliationHistory.js";

function periodResult(returnPeriod, clientGstin, matched, mismatched = 0) {
  return {
    returnPeriod,
    clientGstin,
    status: mismatched ? "needs_review" : "matched",
    documents: [{ id: `${clientGstin}-${returnPeriod}`, originalName: `${returnPeriod}.json`, documentType: "gstr1" }],
    summary: { totalChecks: matched + mismatched, matched, mismatched, exceptions: 0, highRisk: mismatched, totalAbsoluteDifference: mismatched * 25 },
    comparisons: [{ id: `${returnPeriod}-comparison`, status: mismatched ? "mismatch" : "matched" }],
    exceptions: [],
    suggestions: mismatched ? ["Review the difference."] : [],
  };
}

test("groups reconciliation periods by client and year and keeps the latest monthly run", () => {
  const clientA = "24AEXPS3034H1Z6";
  const clientB = "27AAAAA0000A1Z5";
  const history = indexReconciliationHistory([
    { id: "older-april", createdAt: "2025-05-01T00:00:00.000Z", result: { clientGstin: clientA, periods: [periodResult("042025", clientA, 3, 1)] } },
    { id: "latest-april", createdAt: "2025-05-02T00:00:00.000Z", result: { clientGstin: clientA, periods: [periodResult("042025", clientA, 4)] } },
    { id: "may-and-next-year", createdAt: "2026-04-01T00:00:00.000Z", result: { clientGstin: clientA, periods: [periodResult("052025", clientA, 5), periodResult("042026", clientA, 6)] } },
    { id: "other-client", createdAt: "2025-06-01T00:00:00.000Z", result: { clientGstin: clientB, periods: [periodResult("052025", clientB, 7)] } },
  ]);

  assert.deepEqual(Object.keys(history).sort(), [clientA, clientB]);
  assert.deepEqual(Object.keys(history[clientA]).sort(), ["2025", "2026"]);
  assert.deepEqual(history[clientA]["2025"].map((item) => item.returnPeriod), ["042025", "052025"]);
  assert.equal(history[clientA]["2025"][0].sourceReconciliationId, "latest-april");
  assert.equal(history[clientB]["2025"][0].clientGstin, clientB);
});

test("builds one year report while preserving monthly tabs and aggregate metrics", () => {
  const gstin = "24AEXPS3034H1Z6";
  const periods = [
    { ...periodResult("042025", gstin, 4), sourceReconciliationId: "april", reconciledAt: "2025-05-01T00:00:00.000Z" },
    { ...periodResult("052025", gstin, 3, 1), sourceReconciliationId: "may", reconciledAt: "2025-06-01T00:00:00.000Z" },
  ];
  const reconciliation = buildYearReconciliation(gstin, "2025", periods);

  assert.equal(reconciliation.status, "needs_review");
  assert.deepEqual(reconciliation.result.periods.map((item) => item.returnPeriod), ["042025", "052025"]);
  assert.deepEqual(reconciliation.result.summary, { totalChecks: 8, matched: 7, mismatched: 1, exceptions: 0, highRisk: 1, totalAbsoluteDifference: 25 });
  assert.equal(reconciliation.result.clientGstin, gstin);
  assert.equal(reconciliation.createdAt, "2025-06-01T00:00:00.000Z");
});
