import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateScrutinyResponse } from "../src/scrutiny/api/validators.js";
import { readPdfLines } from "../src/scrutiny/core/pdfText.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tallyPath = path.join(root, "sample-docs", "Tally.json");
const workbookPath = path.join(root, "sample-docs", "New Data (1)", "Gaytri Multi Ledger.xlsx");
const aisPath = path.join(root, "sample-docs", "New Data (1)", "AIS Wo Pass.pdf");
const supportDir = path.join(root, "sample-docs", "New Data (1)");
const ashwinDir = path.join(root, "sample-docs", "Ashwin coal");
const supportFiles = [
  ["CFZPS9235R-2026.pdf", "form_26as", 32],
  ["Computation 25-26.pdf", "tax_computation", 10],
  ["ElectronicCashLedger (7).pdf", "gst_cash_ledger", 104],
  ["ElectronicCreditLedger (6).pdf", "gst_credit_ledger", 26],
  ["SingleProductLedger_Gayatri.XLS", "stock_product_ledger", 260],
];
const nextYearFiles = [
  ["ElectronicCashLedger (8).pdf", "gst_cash_ledger", 24],
  ["ElectronicCreditLedger (7).pdf", "gst_credit_ledger", 8],
];
const enabled = process.env.SCRUTINY_REAL_SAMPLES === "1" &&
  [tallyPath, workbookPath, aisPath, ...[...supportFiles, ...nextYearFiles]
    .map(([name]) => path.join(supportDir, name))].every(fs.existsSync);

test("real scrutiny samples upload, parse and run through authenticated APIs", { skip: !enabled }, async () => {
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "scrutiny-real-api-"));
  process.env.NODE_ENV = "test";
  process.env.GST_DATA_DIR = testDir;
  process.env.GST_DATABASE_PATH = path.join(testDir, "audit.sqlite");
  process.env.GST_UPLOAD_DIR = path.join(testDir, "sales-uploads");
  process.env.AUDIT_UPLOAD_DIR = path.join(testDir, "audit-uploads");
  const [{ createApp }, { closeDb }] = await Promise.all([
    import("../src/app.js"), import("../src/db/database.js"),
  ]);
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const api = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const registration = await fetch(`${api}/auth/register`, { method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Sample Auditor", email: "scrutiny-real@example.test",
        password: "safe-password-2026" }) });
    assert.equal(registration.status, 201);
    const cookie = registration.headers.get("set-cookie").split(";")[0];
    const formText = (await readPdfLines(path.join(supportDir, supportFiles[0][0]))).lines
      .map((line) => line.text).join("\n");
    const taxpayerId = /\b[A-Z]{5}\d{4}[A-Z]\b/.exec(formText)?.[0];
    assert.ok(taxpayerId);
    const createReport = async (fiscalYear) => {
      const response = await fetch(`${api}/scrutiny/audit-reports`, { method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: `Real sample ${fiscalYear}`, fiscalYear, taxpayerId }) });
      assert.equal(response.status, 201);
      const { auditReport } = await response.json();
      return `${api}/scrutiny/audit-reports/${auditReport.id}`;
    };
    const upload = async (base, filePath, role) => {
      const form = new FormData();
      form.append("role", role);
      form.append("completeExport", "true");
      form.append("file", new File([fs.readFileSync(filePath)], path.basename(filePath)));
      const response = await fetch(`${base}/sources`, { method: "POST", headers: { cookie }, body: form });
      assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
      return (await response.json()).source;
    };
    const getSource = async (base, source) => {
      const response = await fetch(`${base}/sources/${source.id}`, { headers: { cookie } });
      assert.equal(response.status, 200);
      const detail = (await response.json()).source;
      validateScrutinyResponse("getAuditSource", { source: detail });
      return detail;
    };
    const runChecks = async (base, selectedSourceIds, checkIds) => {
      const response = await fetch(`${base}/runs`, { method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ selectedSourceIds, checkIds }) });
      assert.equal(response.status, 202);
      const { run } = await response.json();
      let current;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        ({ run: current } = await (await fetch(`${base}/runs/${run.id}`, { headers: { cookie } })).json());
        if (["completed", "failed"].includes(current.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(current.status, "completed", JSON.stringify(current.error));
      return new Map(current.results.map((result) => [result.checkId, result]));
    };
    const base = await createReport("2025-2026");
    const tally = await upload(base, tallyPath, "books_vouchers");
    const workbook = await upload(base, workbookPath, "books_ledgers");
    const ais = await upload(base, aisPath, "ais");
    const support = [];
    for (const [name, documentType, count] of supportFiles) {
      const source = await upload(base, path.join(supportDir, name), "supporting_document");
      const detail = await getSource(base, source);
      assert.equal(detail.parsed.documentType, documentType);
      assert.equal(detail.parsed.recordCount, count);
      assert.equal(detail.parseStatus, "ready", name);
      support.push(source);
    }
    assert.equal(tally.parseStatus, "ready");
    assert.equal(workbook.parseStatus, "ready");
    // The scan has OCR rows that fail its printed controls; do not mark it ready.
    assert.equal(ais.parseStatus, "insufficient_data");
    const details = await Promise.all([tally, workbook, ais].map((source) => getSource(base, source)));
    assert.equal(details[0].parsed.recordCount, 7213);
    assert.equal(details[1].parsed.recordCount, 119);
    assert.equal(details[2].parsed.documentType, "ais");
    assert.equal(details[2].parsed.ocrUsed, true);
    assert.equal(details[2].parsed.pageCount, 6);
    assert.equal(details[2].parsed.tables.length, 45);
    assert.ok(details[2].parsed.records.some((record) =>
      record.informationCode === "194A" && record.amount === "11043.00"));
    assert.ok(details[2].parsed.tables.some((table) =>
      table.informationCode === "EXC-GSTR3B" && table.status === "unverified" &&
      table.issues.some((issue) => issue.code === "AIS_TABLE_COUNT_MISMATCH")));
    assert.ok(details[2].parsed.tables.every((table) => table.status !== "verified" || !table.issues.length));
    const accountRoles = Object.fromEntries(details[1].parsed.records.flatMap((row) => {
      const role = /^Sales A\/c/i.test(row.ledger) ? "sales" :
        /^Cash Ledger\(CGST\)/i.test(row.ledger) ? "gst_cash_cgst" :
        /^Cash Ledger\(SGST\)/i.test(row.ledger) ? "gst_cash_sgst" :
        /^T\s*D\s*S\s*A\/c/i.test(row.ledger) ? "tds_receivable" :
        /^TCS ON SCRAP$/i.test(row.ledger) ? "tcs_receivable" : null;
      return role ? [[row.ledger, role]] : [];
    }));
    const profileResponse = await fetch(`${api}/scrutiny/audit-reports/mapping-profiles`, {
      method: "POST", headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ name: "Gayatri fixture roles", role: "books_ledgers",
        configuration: { accountRoles, fields: {} } }) });
    assert.equal(profileResponse.status, 201);
    const profileId = (await profileResponse.json()).profile.id;
    assert.equal((await fetch(`${api}/scrutiny/audit-reports/mapping-profiles/${profileId}/approve`,
      { method: "POST", headers: { cookie } })).status, 200);
    const deriveResponse = await fetch(`${base}/sources/derive`, { method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ fromSourceId: workbook.id, profileId, completeExport: true }) });
    assert.equal(deriveResponse.status, 201);
    const mappedWorkbook = (await deriveResponse.json()).source;
    const results = await runChecks(base, [tally.id, mappedWorkbook.id, ais.id, ...support.map((source) => source.id)],
      ["B01", "B02", "B04", "B06", "B07", "B08", "B09", "B10", "B11", "B20", "AIS01", "AIS02", "A26", "G01", "G02", "S01", "T03", "T09"]);
    assert.equal(results.get("AIS01").status, "insufficient_data");
    assert.equal(results.get("AIS02").status, "insufficient_data");
    assert.equal(results.get("A26").status, "review");
    assert.equal(results.get("G02").status, "review");
    assert.equal(results.get("T03").status, "review");
    assert.equal(results.get("G01").status, "matched");
    assert.equal(results.get("S01").status, "matched");
    assert.match(results.get("B20").summary, /1\/119 statement ledgers map/);
    assert.ok(results.get("A26").evidence.some((item) =>
      item.section === "194A" && item.comparison === "table_agrees"));
    assert.ok(results.get("A26").evidence.some((item) =>
      item.section === "194Q" && item.aisCandidateAmount === "3467584.00" &&
      item.comparison === "candidate_agrees" && item.tableStatus === "unverified"));
    assert.ok(results.get("A26").evidence.some((item) =>
      item.section === "206CE" && item.comparison === "table_agrees"));
    assert.match(results.get("AIS02").summary, /incomplete|could not be normalized/i);
    assert.ok(results.get("AIS02").evidence.some((item) => item.issues?.length));
    assert.ok(results.get("T03").evidence.some((item) => item.type === "tds"));
    assert.ok(results.get("G02").evidence.some((item) => item.taxHead === "CGST"));
    assert.match(results.get("B01").summary, /2483 voucher/);
    assert.equal(results.get("B02").status, "review");
    assert.match(results.get("B02").summary, /ledger roll-forward\(s\) assessed/);
    assert.ok(results.get("B02").evidence.some((row) => row.kind === "unassessable_ledger"));
    assert.equal(results.get("B08").status, "review");
    assert.ok(results.get("B08").evidence.some((row) => row.voucherIds.length > 1));
    assert.equal(results.get("B09").evidence.length, 2);
    assert.equal(results.get("B10").evidence.length, 3);
    assert.equal(results.get("B11").status, "insufficient_data");

    const nextBase = await createReport("2026-2027");
    const nextSources = [];
    for (const [name, documentType, count] of nextYearFiles) {
      const source = await upload(nextBase, path.join(supportDir, name), "supporting_document");
      const detail = await getSource(nextBase, source);
      assert.equal(detail.parsed.documentType, documentType);
      assert.equal(detail.parsed.recordCount, count);
      assert.equal(detail.parseStatus, "ready");
      nextSources.push(source.id);
    }
    const nextResults = await runChecks(nextBase, nextSources, ["G01"]);
    assert.equal(nextResults.get("G01").status, "matched");

    if (["All Ledger.xls", "TIS.pdf", "26AS.pdf", "AIS.pdf", "ElectronicCashLedger.pdf",
      "ElectronicCreditLedger.pdf", "Query Sheet.xlsx"].every((name) => fs.existsSync(path.join(ashwinDir, name)))) {
      const response = await fetch(`${api}/scrutiny/audit-reports`, { method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "Ashwin fixture 2025-2026", fiscalYear: "2025-2026",
          taxpayerId: "AADFA6153H" }) });
      assert.equal(response.status, 201);
      const ashwinBase = `${api}/scrutiny/audit-reports/${(await response.json()).auditReport.id}`;
      const ashwinLedgers = await upload(ashwinBase, path.join(ashwinDir, "All Ledger.xls"), "books_ledgers");
      const ashwinDetail = await getSource(ashwinBase, ashwinLedgers);
      assert.equal(ashwinDetail.parseStatus, "ready");
      assert.equal(ashwinDetail.parsed.recordCount, 308);
      assert.ok(ashwinDetail.parsed.rawRows.length > 18000); // original nonempty workbook rows remain available
      const ashwinRoles = { "SALES GST AC": "sales", "PURCHASE AC": "purchases",
        "INTEREST ON FD": "interest_income", "TDS RECEIVABLE": "tds_receivable",
        "TCS RECEIVABLE": "tcs_receivable" };
      const createProfileResponse = await fetch(`${api}/scrutiny/audit-reports/mapping-profiles`, {
        method: "POST", headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "Ashwin fixture roles", role: "books_ledgers",
          configuration: { fields: {}, accountRoles: ashwinRoles } }) });
      assert.equal(createProfileResponse.status, 201);
      const ashwinProfileId = (await createProfileResponse.json()).profile.id;
      assert.equal((await fetch(`${api}/scrutiny/audit-reports/mapping-profiles/${ashwinProfileId}/approve`,
        { method: "POST", headers: { cookie } })).status, 200);
      const ashwinDerivedResponse = await fetch(`${ashwinBase}/sources/derive`, { method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ fromSourceId: ashwinLedgers.id, profileId: ashwinProfileId,
          completeExport: true }) });
      assert.equal(ashwinDerivedResponse.status, 201);
      const ashwinMapped = (await ashwinDerivedResponse.json()).source;
      const ashwinSupporting = [];
      for (const [name, role, type] of [["TIS.pdf", "supporting_document", "tis"],
        ["26AS.pdf", "supporting_document", "form_26as"],
        ["ElectronicCashLedger.pdf", "supporting_document", "gst_cash_ledger"],
        ["ElectronicCreditLedger.pdf", "supporting_document", "gst_credit_ledger"],
        ["Query Sheet.xlsx", "supporting_document", "audit_queries"],
        ["AIS.pdf", "ais", "ais"]]) {
        const source = await upload(ashwinBase, path.join(ashwinDir, name), role);
        const detail = await getSource(ashwinBase, source);
        assert.equal(detail.parsed.documentType, type, name);
        ashwinSupporting.push(source);
      }
      const ashwinResults = await runChecks(ashwinBase,
        [ashwinMapped.id, ...ashwinSupporting.map((source) => source.id)],
        ["B02", "B04", "B06", "B08", "B09", "B10", "B11", "G01", "X01", "T03"]);
      assert.equal(ashwinResults.get("B02").status, "review");
      assert.match(ashwinResults.get("B02").summary, /67 ledger roll-forward\(s\) assessed/);
      assert.equal(ashwinResults.get("B04").status, "review");
      assert.match(ashwinResults.get("B04").summary, /16 dormant balance candidate/);
      assert.ok(ashwinResults.get("B08").evidence.length > 0);
      assert.equal(ashwinResults.get("B09").evidence.length, 2);
      assert.equal(ashwinResults.get("B10").evidence.length, 9);
      assert.equal(ashwinResults.get("B11").evidence.length, 3);
      assert.ok(ashwinResults.get("X01").evidence.some((item) =>
        item.label === "TIS gst_turnover" && item.expectedAmount && item.actualAmount));
      assert.ok(ashwinResults.get("X01").evidence.some((item) => item.sourceRefs?.length));
    }

    for (const name of ["100001.zip", "TDBK1800_100004.001"]) {
      const form = new FormData();
      form.append("role", "supporting_document");
      form.append("file", new File([fs.readFileSync(path.join(supportDir, name))], name));
      const response = await fetch(`${base}/sources`, { method: "POST", headers: { cookie }, body: form });
      assert.equal(response.status, 400, `${name} must not be misidentified as a parsed source`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    closeDb();
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});
