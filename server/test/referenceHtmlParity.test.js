import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { parseAuditSource } from "../src/scrutiny/core/parseAuditSource.js";
import { runScrutiny } from "../src/scrutiny/core/runScrutiny.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const enabled = process.env.SCRUTINY_REFERENCE_PARITY === "1";
const findingEvidence = (row) => (row.evidence || []).filter((item) =>
  !["classification_not_established", "source_limitation"].includes(item.kind));

test("reference HTML and API scrutiny agree on reproducible ledger candidates", { skip: !enabled }, async () => {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const xlsx = await fs.readFile(path.join(root, "node_modules/xlsx/dist/xlsx.full.min.js"));
    await page.route("https://**/*", async (route) => {
      if (route.request().url().includes("xlsx.full.min.js")) return route.fulfill({
        status: 200, contentType: "application/javascript", body: xlsx,
      });
      return route.abort();
    });
    await page.goto(pathToFileURL(path.join(root, "sample-docs/Ledger_Scrutiny_TDS_CRM_44.html")).href);
    const csv = [
      "Ledger,Opening Balance,Closing Balance,Debit,Credit,Date,Voucher No,Particulars",
      "Suspense Account,100,100,0,0,01/04/2025,S1,Opening balance",
      "Input CGST,0,100,100,0,02/04/2025,G1,Input tax",
      "Prepaid Insurance,800,800,0,0,01/04/2025,P1,Insurance",
      "Insurance Premium,0,0,900,0,02/04/2025,I1,Insurance premium",
    ].join("\n");
    await page.setInputFiles("#dataFile", { name: "scrutiny-reference-fixture.csv",
      mimeType: "text/csv", buffer: Buffer.from(csv) });
    await page.waitForFunction(() => currentRows.length === 4);
    const reference = await page.evaluate(() => {
      runAnalysis();
      runPrepaidReversalCheck();
      return { fieldMap: getFieldMap(),
        issues: currentIssues.map((issue) => ({ ledger: issue.ledger, check: issue.check })),
        prepaid: window.taxAisStore?.prepaidRev || [] };
    });
    assert.equal(reference.fieldMap.ledger, "Ledger");
    const records = [
      { ledger: "Suspense Account", openingBalance: "100.00", closingBalance: "100.00", debits: "0.00", credits: "0.00" },
      { ledger: "Input CGST", openingBalance: "0.00", closingBalance: "100.00", debits: "100.00", credits: "0.00" },
      { ledger: "Prepaid Insurance", openingBalance: "800.00", closingBalance: "800.00", debits: "0.00", credits: "0.00" },
      { ledger: "Insurance Premium", openingBalance: "0.00", closingBalance: "0.00", debits: "900.00", credits: "0.00" },
    ];
    const api = new Map(runScrutiny({ sources: [{ sourceId: "fixture", role: "books_ledgers",
      status: "ready", completeExport: true, financialYear: "2025-2026", records }],
    checkIds: ["B06", "B09", "B10", "B11"] }).results.map((row) => [row.checkId, row]));
    assert.equal(reference.issues.filter((row) => row.check === "Suspense balance").length,
      findingEvidence(api.get("B06")).length);
    assert.equal(reference.issues.filter((row) => row.check === "Pending GST ledger balance").length,
      findingEvidence(api.get("B09")).length);
    assert.equal(reference.prepaid.filter((row) => row.status === "Possible missing reversal").length,
      api.get("B11").evidence.filter((row) => row.comparison === "possible_missing_reversal").length);
    assert.equal(api.get("B10").evidence.filter((row) => row.comparison === "expense_candidate").length, 1);

    const workbook = path.join(root, "sample-docs/New Data (1)/Gaytri Multi Ledger.xlsx");
    await page.setInputFiles("#dataFile", workbook);
    await page.waitForFunction(() => currentRows.length > 1000, { timeout: 30000 });
    const referenceGayatri = await page.evaluate(() => {
      runAnalysis();
      runInsurancePrepaidReview();
      runPrepaidReversalCheck();
      const count = (check) => currentIssues.filter((item) => item.check === check).length;
      return { rowCount: currentRows.length, suspense: count("Suspense balance"),
        pendingGst: count("Pending GST ledger balance"),
        insuranceFlag: window.ledgerMatchStore.insFlag.length,
        prepaidReversal: window.taxAisStore.prepaidRev.filter((item) =>
          item.status === "Possible missing reversal").length };
    });
    const parsed = await parseAuditSource({ filePath: workbook, originalName: path.basename(workbook),
      role: "books_ledgers", sourceId: "gayatri", financialYear: "2025-2026", completeExport: true });
    const ours = new Map(runScrutiny({ sources: [parsed], checkIds: ["B06", "B09", "B10", "B11"] })
      .results.map((row) => [row.checkId, row]));
    assert.equal(referenceGayatri.suspense, findingEvidence(ours.get("B06")).length);
    assert.equal(referenceGayatri.pendingGst, findingEvidence(ours.get("B09")).length);
    assert.equal(referenceGayatri.insuranceFlag, ours.get("B10").evidence.filter((item) =>
      item.comparison === "expense_candidate").length);
    assert.equal(referenceGayatri.prepaidReversal, ours.get("B11").evidence.filter((item) =>
      item.comparison === "possible_missing_reversal").length);
  } finally {
    await browser.close();
  }
});
