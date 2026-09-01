import assert from "node:assert/strict";
import test from "node:test";
import { buildYearReconciliation, indexReconciliationHistory } from "../src/utils/reconciliationHistory.js";

function periodResult(returnPeriod, clientGstin, matched, mismatched = 0) {
  return {
    returnPeriod,
    clientGstin,
    status: mismatched ? "needs_review" : "matched",
    documents: [{ id: `${clientGstin}-${returnPeriod}`, originalName: `${returnPeriod}.json`, documentType: "gstr1", gstin: clientGstin }],
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

test("does not categorize months backed by unselected returns or without an identifiable GST-return client", () => {
  const gstin = "24AEXPS3034H1Z6";
  const document = (id, documentType, documentGstin = gstin) => ({ id, documentType, gstin: documentGstin, originalName: `${id}.json` });
  const result = (returnPeriod, documents) => ({ ...periodResult(returnPeriod, gstin, 4), documents });
  const history = indexReconciliationHistory([
    {
      id: "contains-unselected-return",
      createdAt: "2025-07-03T00:00:00.000Z",
      documentIds: ["april-gstr1", "april-gstr3b"],
      result: { clientGstin: gstin, periods: [result("042025", [document("april-gstr1", "gstr1"), document("april-gstr3b", "gstr3b"), document("unselected-gstr1", "gstr1", null)])] },
    },
    {
      id: "contains-gstinless-selected-return",
      createdAt: "2025-07-02T00:00:00.000Z",
      documentIds: ["may-gstr1", "may-gstr3b"],
      result: { clientGstin: gstin, periods: [result("052025", [document("may-gstr1", "gstr1"), document("may-gstr3b", "gstr3b", null)])] },
    },
    {
      id: "valid-june",
      createdAt: "2025-07-01T00:00:00.000Z",
      documentIds: ["june-gstr1", "june-gstr3b"],
      result: { clientGstin: gstin, periods: [result("062025", [document("june-gstr1", "gstr1"), document("june-gstr3b", "gstr3b")])] },
    },
    {
      id: "all-gst-returns-missing-gstin",
      createdAt: "2025-07-01T00:00:00.000Z",
      documentIds: ["july-gstr1", "july-gstr3b", "july-books"],
      result: { clientGstin: gstin, periods: [result("072025", [document("july-gstr1", "gstr1", null), document("july-gstr3b", "gstr3b", null), document("july-books", "salesRegister")])] },
    },
  ]);

  assert.deepEqual(history[gstin]["2025"].map((item) => item.returnPeriod), ["052025", "062025"]);
});
