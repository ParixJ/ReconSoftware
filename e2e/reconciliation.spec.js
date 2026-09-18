import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sampleGstr1 = {
  gstin: "24AEXPS3034H1Z6",
  fp: "032026",
  b2b: [{ ctin: "24AAAAA0000A1Z5", inv: [{ inum: "INV-1001", idt: "05-03-2026", val: 118000, pos: "24", rchrg: "N", itms: [{ itm_det: { txval: 100000, camt: 9000, samt: 9000, iamt: 0, csamt: 0 } }] }] }],
  b2cs: [{ pos: "27", txval: 25000, iamt: 4500, camt: 0, samt: 0, csamt: 0 }],
  exp: [{ inv: [{ inum: "EXP-2001", idt: "14-03-2026", val: 50000, itms: [{ itm_det: { txval: 50000, iamt: 0, csamt: 0 } }] }] }],
  cdnr: [{ ctin: "24AAAAA0000A1Z5", nt: [{ ntty: "C", nt_num: "CN-1", nt_dt: "20-03-2026", val: 11800, itms: [{ itm_det: { txval: 10000, camt: 900, samt: 900, iamt: 0, csamt: 0 } }] }] }],
  nil: { inv: [{ nil_amt: 6000, expt_amt: 4000, ngsup_amt: 5000 }] },
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
process.env.NODE_ENV = "test";
let testDataDir;
let apiServer;
let closeDatabase;

function workbookCell(xml, cell) {
  const match = xml.match(new RegExp(`<c\\s+r="${cell}"[^>]*>\\s*<v>([^<]*)<\\/v>`));
  return match ? Number(match[1]) : null;
}

async function chooseOption(page, label, option) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test.beforeAll(async () => {
  testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "recon-e2e-"));
  process.env.GST_DATA_DIR = testDataDir;
  process.env.GST_DATABASE_PATH = path.join(testDataDir, "gst-e2e.sqlite");
  process.env.GST_UPLOAD_DIR = path.join(testDataDir, "uploads");
  const [{ createApp }, { closeDb }] = await Promise.all([
    import("../server/src/app.js"),
    import("../server/src/db/database.js"),
  ]);
  closeDatabase = closeDb;
  apiServer = createApp().listen(4187, "127.0.0.1");
  await new Promise((resolve) => apiServer.once("listening", resolve));
});

test.afterAll(async () => {
  try {
    if (apiServer) await new Promise((resolve) => {
      apiServer.close(resolve);
      apiServer.closeAllConnections?.();
    });
  } finally {
    closeDatabase?.();
    if (testDataDir) fs.rmSync(testDataDir, { recursive: true, force: true });
  }
});

test("auditor can choose and persist dark mode from the authentication page", async ({ page }) => {
  const email = `theme-auditor-${Date.now()}@example.test`;
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/auth");
  await expect(page).toHaveTitle("ReconSoft");
  await expect(page.getByRole("heading", { name: "Sign in to ReconSoft" })).toBeVisible();
  const rootElement = page.locator("html");
  const authCardBounds = await page.locator('[data-slot="card"]').boundingBox();
  const viewport = page.viewportSize();
  expect(Math.abs((authCardBounds.x + authCardBounds.width / 2) - viewport.width / 2)).toBeLessThan(2);
  expect(Math.abs((authCardBounds.y + authCardBounds.height / 2) - viewport.height / 2)).toBeLessThan(2);
  await expect(rootElement).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(rootElement).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('[data-slot="card"]')).toHaveCSS("background-color", "rgb(0, 0, 0)");

  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("Theme Auditor");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("safe-password-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Reconciliation workspace" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ReconSoft" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(page.locator('#workspace [data-slot="card"]')).toHaveCount(4);

  await expect(rootElement).toHaveAttribute("data-theme", "dark");
  await expect(rootElement).toHaveCSS("color-scheme", "dark");
  await expect(page.locator('[data-slot="card"]').first()).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(page.locator('[data-slot="card"]').first()).toHaveCSS("border-top-width", "0px");
  await expect(page.locator("body")).toHaveCSS("font-family", "Arial, sans-serif");
  await expect(page.getByRole("heading", { name: "Reconciliation workspace" })).toHaveCSS("font-weight", "400");
  const sectionWidths = await page.locator('#workspace [data-slot="card"]').evaluateAll((elements) => (
    elements.map((element) => Math.round(element.getBoundingClientRect().width))
  ));
  expect(new Set(sectionWidths).size).toBe(1);
  const boldText = await page.locator("body *").evaluateAll((elements) => elements
    .filter((element) => element.textContent?.trim() && Number.parseInt(getComputedStyle(element).fontWeight, 10) > 400)
    .map((element) => element.textContent.trim().slice(0, 80)));
  expect(boldText).toEqual([]);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Reconciliation workspace" })).toBeVisible();
  await expect(rootElement).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Switch to light mode" })).toBeVisible();
  await page.getByRole("link", { name: "Reconciliations" }).click();
  await expect(page.getByRole("heading", { name: "Previous reconciliations" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No reconciliations ran" })).toBeVisible();
});

test("auditor uploads three returns, reviews mapping, and reconciles", async ({ page }) => {
  const email = `auditor-${Date.now()}@example.test`;
  await page.goto("/auth");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("Playwright Auditor");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("safe-password-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Reconciliation workspace" })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles([
    { name: "gstr1-march-2026.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(sampleGstr1)) },
    { name: "gstr3b-march-2026.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(sampleGstr3b)) },
    { name: "returns_R2B_24AEXPS3034H1Z6_032026.json", mimeType: "application/json", buffer: fs.readFileSync(path.join(root, "docs/returns_R2B_24AEXPS3034H1Z6_032026.json")) },
  ]);
  await expect(page.getByText("3 documents ready")).toBeVisible();
  await expect(page.getByRole("cell", { name: "GSTR-1", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "GSTR-3B", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "GSTR-2B", exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Uploaded documents" }).locator('[data-kind="document-type"]').first()).toHaveCSS("border-radius", "0px");
  await expect(page.getByRole("table", { name: "Uploaded documents" }).locator('[data-kind="document-type"]').first()).toHaveCSS("font-weight", "400");
  await expect(page.getByRole("table", { name: "Uploaded documents" }).locator('[data-kind="status"]').first()).toHaveCSS("border-radius", "0px");

  await page.getByRole("button", { name: "Modify mapping" }).first().click();
  await expect(page.getByRole("heading", { name: "Return identity" })).toBeVisible();
  await expect(page.getByText("Official GST schema recognized")).toBeVisible();
  await page.screenshot({ path: path.join(root, "test-results/gst-mapping-page.png"), fullPage: true });
  await page.getByRole("button", { name: "Back to Home" }).click();

  await page.getByRole("button", { name: "Run on 3 files" }).click();
  await expect(page).toHaveURL(/\/reconciliations\?gstin=24AEXPS3034H1Z6&year=2026/);
  await expect(page.getByRole("combobox", { name: "Client GSTIN", exact: true })).toHaveText("24AEXPS3034H1Z6");
  await expect(page.getByRole("combobox", { name: "Return year", exact: true })).toHaveText("2026");
  await expect(page.getByText("Review required").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Mar 2026/ })).toBeVisible();
  const marchRow = page.getByRole("table", { name: "Period reconciliation summary" }).getByRole("row", { name: /Mar 2026/ });
  await expect(marchRow).toContainText("20 / 23");
  await marchRow.click();
  const marchDialog = page.getByRole("dialog", { name: /Mar 2026 reconciliation details/ });
  await expect(marchDialog.getByText("Suggested review sequence")).toBeVisible();
  await marchDialog.getByRole("button", { name: "Close popup" }).click();
  await page.screenshot({ path: path.join(root, "test-results/reconsoft-flow.png"), fullPage: true });

  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("heading", { name: "Reconciliation workspace" })).toBeVisible();
  const gstr1Row = page.getByRole("row").filter({ hasText: "gstr1-march-2026.json" });
  await gstr1Row.getByRole("button", { name: "Delete gstr1-march-2026.json" }).click();
  const deleteDialog = page.getByRole("alertdialog", { name: "Delete document?" });
  await expect(deleteDialog).toContainText("gstr1-march-2026.json");
  await deleteDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(gstr1Row).toBeVisible();
  await gstr1Row.getByRole("button", { name: "Delete gstr1-march-2026.json" }).click();
  await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Document deleted")).toBeVisible();
  await expect(gstr1Row).toHaveCount(0);

  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select all documents" }).click();
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Clear document selection" }).click();
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select all documents" }).click();
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete selected (2)" }).click();
  await page.getByRole("alertdialog", { name: "Delete selected documents?" }).getByRole("button", { name: "Delete selected", exact: true }).click();
  await expect(page.getByText("2 documents deleted")).toBeVisible();
  await expect(page.getByText("No documents uploaded")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "No documents uploaded" })).toBeVisible();
});

test("auditor reconciles multiple return months in one row per period", async ({ page }) => {
  const gstin = "24AEXPS3034H1Z6";
  const email = `period-auditor-${Date.now()}@example.test`;
  const gstr1 = (fp, invoiceDate, taxableValue, tax) => ({
    gstin,
    fp,
    b2b: [{
      ctin: "24AAAAA0000A1Z5",
      inv: [{ inum: `INV-${fp}`, idt: invoiceDate, val: taxableValue + (tax * 2), itms: [{ itm_det: { txval: taxableValue, camt: tax, samt: tax, iamt: 0, csamt: 0 } }] }],
    }],
  });
  const gstr3b = (retPeriod, taxableValue, tax) => ({
    gstin,
    ret_period: retPeriod,
    sup_details: {
      osup_det: { txval: taxableValue, iamt: 0, camt: tax, samt: tax, csamt: 0 },
      osup_zero: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
      osup_nil_exmp: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
      isup_rev: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
      osup_nongst: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
    },
  });
  const unselectedGstinlessReturn = gstr1("042025", "20-04-2025", 9999, 899.91);
  delete unselectedGstinlessReturn.gstin;

  await page.goto("/auth");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("Multi-period Auditor");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("safe-password-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Reconciliation workspace" })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles([
    { name: "gstr1-april-2025.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(gstr1("042025", "15-04-2025", 1000, 90))) },
    { name: "gstr3b-april-2025.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(gstr3b("042025", 1000, 90))) },
    { name: "gstr1-may-2025.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(gstr1("052025", "15-05-2025", 2000, 180))) },
    { name: "gstr3b-may-2025.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(gstr3b("052025", 2000, 180))) },
    { name: "unselected-gstinless-gstr1-april-2025.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(unselectedGstinlessReturn)) },
  ]);
  await expect(page.getByText("5 selected", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select unselected-gstinless-gstr1-april-2025.json" }).click();
  await expect(page.getByText("4 selected", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run on 4 files" }).click();

  await expect(page.getByRole("heading", { name: /2 return periods/ })).toBeVisible();
  await expect(page.getByText("unselected-gstinless-gstr1-april-2025.json")).toHaveCount(0);
  const periodSummary = page.getByRole("table", { name: "Period reconciliation summary" });
  const aprilRow = periodSummary.getByRole("row", { name: /Apr 2025/ });
  const mayRow = periodSummary.getByRole("row", { name: /May 2025/ });
  await expect(aprilRow).toBeVisible();
  await expect(mayRow).toBeVisible();
  await mayRow.click();
  const mayDialog = page.getByRole("dialog", { name: /May 2025 reconciliation details/ });
  await expect(mayDialog.getByText("Files used for May 2025:")).toBeVisible();
  await mayDialog.getByRole("button", { name: "Close popup" }).click();
  await expect(page.getByRole("tablist", { name: "Reconciliation periods" })).toHaveCount(0);

  await page.getByRole("link", { name: "Home" }).click();
  await page.locator('input[type="file"]').setInputFiles([
    { name: "gstr1-april-2026.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(gstr1("042026", "15-04-2026", 3000, 270))) },
    { name: "gstr3b-april-2026.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(gstr3b("042026", 3000, 270))) },
  ]);
  await expect(page.getByText("2 documents ready")).toBeVisible();
  await page.getByRole("button", { name: "Run on 2 files" }).click();

  const gstinSearch = page.getByLabel("Search GSTIN");
  const gstinSelect = page.getByRole("combobox", { name: "Client GSTIN", exact: true });
  const yearSelect = page.getByRole("combobox", { name: "Return year", exact: true });
  await expect(gstinSelect).toHaveText(gstin);
  await expect(yearSelect).toHaveText("2026");
  await yearSelect.click();
  await expect(page.getByRole("listbox").getByRole("option")).toHaveText(["Select year", "2026", "2025"]);
  await page.getByRole("option", { name: "2025", exact: true }).click();
  await expect(page.getByRole("table", { name: "Period reconciliation summary" }).getByRole("row", { name: /Apr 2025/ })).toBeVisible();
  await expect(page.getByRole("table", { name: "Period reconciliation summary" }).getByRole("row", { name: /May 2025/ })).toBeVisible();
  await chooseOption(page, "Client GSTIN", "Select client GSTIN");
  await gstinSearch.fill("AEXPS3034");
  await gstinSelect.click();
  await expect(page.getByRole("listbox").getByRole("option")).toHaveText(["Select client GSTIN", gstin]);
  await page.keyboard.press("Escape");
  await gstinSearch.press("Enter");
  await expect(gstinSelect).toHaveText(gstin);
  await expect(yearSelect).toHaveText("2026");
  await expect(page).toHaveURL(new RegExp(`/reconciliations\\?gstin=${gstin}&year=2026`));
  await expect(page.getByRole("heading", { name: /Apr 2026/ })).toBeVisible();

  await page.getByRole("button", { name: "Export to Excel" }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export reconciliation" });
  await expect(exportDialog).toBeVisible();
  await exportDialog.getByLabel("Document name").fill(`GST_Reconciliation_${gstin}_2026`);
  await expect(exportDialog.getByRole("combobox", { name: "Document file format" })).toHaveText("Excel (.xlsx)");
  await exportDialog.getByLabel("Return year").fill("2026");
  const downloadPromise = page.waitForEvent("download");
  await exportDialog.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`GST_Reconciliation_${gstin}_2026.xlsx`);
  const workbookFiles = unzipSync(new Uint8Array(fs.readFileSync(await download.path())));
  const workbookXml = strFromU8(workbookFiles["xl/workbook.xml"]);
  const taxableXml = strFromU8(workbookFiles["xl/worksheets/sheet1.xml"]);
  const outputTaxXml = strFromU8(workbookFiles["xl/worksheets/sheet2.xml"]);
  expect(workbookXml).toContain('name="Taxable Value"');
  expect(workbookXml).toContain('name="Output Tax"');
  expect(workbookCell(taxableXml, "B3")).toBe(3000);
  expect(workbookCell(taxableXml, "E3")).toBe(3000);
  expect(workbookCell(taxableXml, "G3")).toBe(3000);
  expect(workbookCell(outputTaxXml, "E3")).toBe(540);
  expect(workbookCell(outputTaxXml, "I3")).toBe(540);

  await page.getByRole("button", { name: "View Apr 2026 details" }).click();
  const aprilDialog = page.getByRole("dialog", { name: "Apr 2026 reconciliation details" });
  const amendment = aprilDialog.getByRole("spinbutton", { name: "Amend GSTR-1 B2B taxable value for Apr 2026", exact: true });
  await expect(amendment).toHaveAttribute("placeholder", "3000");
  await amendment.fill("3200");
  await expect(aprilDialog.getByText("1 amended", { exact: true })).toBeVisible();
  await aprilDialog.getByRole("button", { name: "Close popup" }).click();
  await page.getByRole("button", { name: "Export to Excel" }).click();
  const amendedDownloadPromise = page.waitForEvent("download");
  const amendedResponsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/reconciliations/export"));
  await exportDialog.getByRole("button", { name: "Download" }).click();
  const amendedResponse = await amendedResponsePromise;
  expect(new URL(amendedResponse.url()).pathname).toBe("/api/sales/reconciliations/export");
  expect(amendedResponse.status()).toBe(200);
  const amendedDownload = await amendedDownloadPromise;
  const amendedWorkbook = unzipSync(new Uint8Array(fs.readFileSync(await amendedDownload.path())));
  expect(workbookCell(strFromU8(amendedWorkbook["xl/worksheets/sheet1.xml"]), "B3")).toBe(3200);
  await page.reload();
  await expect(page.getByRole("table", { name: "Period reconciliation summary" }).getByRole("row", { name: /Apr 2026/ })).toBeVisible();
  await page.getByRole("button", { name: "View Apr 2026 details" }).click();
  await expect(amendment).toHaveValue("");
  await expect(amendment).toHaveAttribute("placeholder", "3000");
});

test("filed return ranges stay one period and history deletion preserves uploads", async ({ page }) => {
  await page.goto("/auth");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("Range Auditor");
  await page.getByLabel("Email address").fill(`range-auditor-${Date.now()}@example.test`);
  await page.getByLabel("Password").fill("safe-password-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Reconciliation workspace" })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([
    { name: "gstr1-jan-march-2026.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...sampleGstr1, fp: "012026-032026" })) },
    { name: "gstr3b-jan-march-2026.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...sampleGstr3b, ret_period: "012026-032026" })) },
  ]);
  await page.getByRole("button", { name: "Run on 2 files" }).click();
  const summary = page.getByRole("table", { name: "Period reconciliation summary" });
  const rangeRow = summary.getByRole("row", { name: /Jan 2026 - Mar 2026/ });
  await expect(rangeRow).toBeVisible();
  await expect(summary.getByRole("row")).toHaveCount(2);
  await page.reload();
  await expect(rangeRow).toBeVisible();
  await expect(summary.getByRole("row")).toHaveCount(2);
  page.once("dialog", (dialog) => dialog.dismiss());
  await rangeRow.getByRole("button", { name: "Delete reconciliation for Jan 2026 - Mar 2026" }).click();
  await expect(rangeRow).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await rangeRow.getByRole("button", { name: "Delete reconciliation for Jan 2026 - Mar 2026" }).click();
  await expect(page.getByRole("heading", { name: "No reconciliations ran" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "No reconciliations ran" })).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("table", { name: "Uploaded documents" }).getByRole("row")).toHaveCount(3);
  await expect(page.getByRole("checkbox", { name: "Select gstr1-jan-march-2026.json", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Select gstr3b-jan-march-2026.json", exact: true })).toBeVisible();
});

test("auditor cannot reconcile documents belonging to different client GSTINs", async ({ page }) => {
  const clientAGstin = "29AABFB5678G1Z8";
  const clientBGstin = "24AEXPS3034H1Z6";
  const email = `cross-examine-auditor-${Date.now()}@example.test`;
  const gstr1 = {
    gstin: clientAGstin,
    fp: "042025",
    b2b: [{ ctin: "24AAAAA0000A1Z5", inv: [{ inum: "INV-1", idt: "15-04-2025", val: 1180, itms: [{ itm_det: { txval: 1000, camt: 90, samt: 90, iamt: 0, csamt: 0 } }] }] }],
  };
  const gstr3b = {
    gstin: clientBGstin,
    ret_period: "042025",
    sup_details: {
      osup_det: { txval: 1000, iamt: 0, camt: 90, samt: 90, csamt: 0 },
      osup_zero: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
      osup_nil_exmp: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
      isup_rev: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
      osup_nongst: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 },
    },
  };

  await page.goto("/auth");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("Cross Examination Auditor");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("safe-password-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.locator('input[type="file"]').setInputFiles([
    { name: "client-a-gstr1.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(gstr1)) },
    { name: "client-b-gstr3b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(gstr3b)) },
  ]);

  await expect(page.getByRole("button", { name: "Resolve GSTIN mismatch" })).toBeDisabled();

  const gstr3bRow = page.getByRole("row").filter({ hasText: "client-b-gstr3b.json" });
  await gstr3bRow.getByRole("button", { name: "Modify mapping" }).click();
  await page.getByLabel("Client GSTIN").fill(clientAGstin);
  await page.getByRole("button", { name: "Save mapping" }).click();
  await expect(page.getByRole("button", { name: "Run on 2 files" })).toBeEnabled();
});

test("auditor always sees every original source field", async ({ page }) => {
  const email = `mapping-auditor-${Date.now()}@example.test`;
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/auth");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("Mapping Auditor");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("safe-password-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Reconciliation workspace" })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({ name: "unmapped-ledger.csv", mimeType: "text/csv", buffer: Buffer.from(unmappedLedger) });
  const tabPanel = page.getByRole("tabpanel");
  await expect(tabPanel.getByRole("heading", { name: "Expected reconciliation fields were not mapped" })).toHaveCount(0);
  await expect(tabPanel.getByRole("columnheader", { name: "Ledger Ref", exact: true })).toBeVisible();
  await expect(tabPanel.getByRole("columnheader", { name: "Party Label", exact: true })).toBeVisible();
  await expect(tabPanel.getByRole("columnheader", { name: "Net Figure", exact: true })).toBeVisible();
  await expect(tabPanel.getByRole("columnheader", { name: "Tax Figure", exact: true })).toBeVisible();
  await expect(tabPanel.getByRole("gridcell", { name: "L-1001", exact: true })).toBeVisible();
  await expect(tabPanel.getByRole("button", { name: "Modify mapping" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Uploaded documents" }).locator('[data-kind="status"]').first()).toHaveCSS("color", "rgb(180, 35, 45)");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.getByRole("table", { name: "Uploaded documents" }).locator('[data-kind="status"]').first()).toHaveCSS("color", "rgb(240, 111, 118)");
  await page.screenshot({ path: path.join(root, "test-results/gst-original-fields-view.png"), fullPage: true });
});
