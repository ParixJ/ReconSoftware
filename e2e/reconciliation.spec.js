import fs from "node:fs";
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
process.env.GST_DATA_DIR = path.join(root, "server/data/e2e-data");
process.env.GST_DATABASE_PATH = path.join(root, "server/data/e2e-data/gst-e2e.sqlite");
process.env.GST_UPLOAD_DIR = path.join(root, "server/data/e2e-data/uploads");

let apiServer;
let closeDatabase;

function workbookCell(xml, cell) {
  const match = xml.match(new RegExp(`<c\\s+r="${cell}"[^>]*>\\s*<v>([^<]*)<\\/v>`));
  return match ? Number(match[1]) : null;
}

test.beforeAll(async () => {
  const [{ createApp }, { closeDb }] = await Promise.all([
    import("../server/src/app.js"),
    import("../server/src/db/database.js"),
  ]);
  closeDatabase = closeDb;
  apiServer = createApp().listen(4187, "127.0.0.1");
  await new Promise((resolve) => apiServer.once("listening", resolve));
});

test.afterAll(async () => {
  await new Promise((resolve) => {
    apiServer.close(resolve);
    apiServer.closeAllConnections?.();
  });
  closeDatabase();
});

test("auditor can choose and persist dark mode from the authentication page", async ({ page }) => {
  const email = `theme-auditor-${Date.now()}@example.test`;
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/auth");
  await expect(page).toHaveTitle("ReconSoft");
  await expect(page.getByRole("heading", { name: "Sign in to ReconSoft" })).toBeVisible();
  const rootElement = page.locator("html");
  await expect(page.locator(".auth-context")).toHaveCount(0);
  const authCardBounds = await page.locator(".auth-card").boundingBox();
  const viewport = page.viewportSize();
  expect(Math.abs((authCardBounds.x + authCardBounds.width / 2) - viewport.width / 2)).toBeLessThan(2);
  expect(Math.abs((authCardBounds.y + authCardBounds.height / 2) - viewport.height / 2)).toBeLessThan(2);
  await expect(rootElement).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(rootElement).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".auth-card")).toHaveCSS("background-color", "rgb(16, 21, 18)");

  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("Theme Auditor");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("safe-password-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Reconciliation workspace" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ReconSoft" })).toBeVisible();
  await expect(page.getByText(/^Step [1-3]$/)).toHaveCount(0);
  await expect(page.getByText("Use the selected files for reconciliation or delete them together.", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Mapped returns use the fixed audit schema", { exact: false })).toHaveCount(0);
  await expect(page.locator("footer")).toHaveCount(0);

  await expect(rootElement).toHaveAttribute("data-theme", "dark");
  await expect(rootElement).toHaveCSS("color-scheme", "dark");
  await expect(page.locator(".panel").first()).toHaveCSS("background-color", "rgb(16, 21, 18)");
  await expect(page.locator(".panel").first()).toHaveCSS("border-top-width", "0px");
  await expect(page.locator("body")).toHaveCSS("font-family", "Arial, sans-serif");
  await expect(page.getByRole("heading", { name: "Reconciliation workspace" })).toHaveCSS("font-weight", "400");
  await expect(page.locator(".page-context")).toHaveCount(0);
  await expect(page.locator(".storage-label")).toHaveCount(0);
  await expect(page.locator(".reconcile-bar")).toHaveCSS("border-top-width", "0px");
  const sectionWidths = await page.locator(".upload-panel, .document-panel, .viewer-panel").evaluateAll((elements) => (
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
  await expect(page.locator(".type-pill").first()).toHaveCSS("border-radius", "0px");
  await expect(page.locator(".type-pill").first()).toHaveCSS("font-weight", "400");
  await expect(page.locator(".status-pill").first()).toHaveCSS("border-radius", "0px");

  await page.getByRole("button", { name: "Modify mapping" }).first().click();
  await expect(page.getByRole("heading", { name: "Return identity" })).toBeVisible();
  await expect(page.getByText("Official GST schema recognized")).toBeVisible();
  await page.screenshot({ path: path.join(root, "test-results/gst-mapping-page.png"), fullPage: true });
  await page.getByRole("button", { name: "Back to Home" }).click();

  await page.getByRole("button", { name: "Run on 3 files" }).click();
  await expect(page).toHaveURL(/\/reconciliations\?gstin=24AEXPS3034H1Z6&year=2026/);
  await expect(page.getByLabel("Client GSTIN")).toHaveValue("24AEXPS3034H1Z6");
  await expect(page.getByLabel("Return year")).toHaveValue("2026");
  await expect(page.getByText("Review required").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Mar 2026/ })).toBeVisible();
  await expect(page.getByText("20 / 23")).toBeVisible();
  await expect(page.getByText("Suggested review sequence")).toBeVisible();
  await page.screenshot({ path: path.join(root, "test-results/reconsoft-flow.png"), fullPage: true });

  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("heading", { name: "Reconciliation workspace" })).toBeVisible();
  const gstr1Row = page.getByRole("row").filter({ hasText: "gstr1-march-2026.json" });
  page.once("dialog", (dialog) => dialog.accept());
  await gstr1Row.getByRole("button", { name: "Delete gstr1-march-2026.json" }).click();
  await expect(page.getByText("Document deleted")).toBeVisible();
  await expect(gstr1Row).toHaveCount(0);

  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select all documents" }).click();
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Clear document selection" }).click();
  await expect(page.getByText("0 selected", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select all documents" }).click();
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete selected (2)" }).click();
  await expect(page.getByText("2 documents deleted")).toBeVisible();
  await expect(page.getByText("No documents uploaded")).toBeVisible();
});

test("auditor reconciles multiple return months in one combined tab per period", async ({ page }) => {
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
  const aprilTab = page.getByRole("tab", { name: /Apr 2025/ });
  const mayTab = page.getByRole("tab", { name: /May 2025/ });
  await expect(aprilTab).toBeVisible();
  await expect(mayTab).toBeVisible();
  await expect(aprilTab).toHaveAttribute("aria-selected", "true");
  await mayTab.click();
  await expect(mayTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Files used for May 2025:")).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Reconciliation periods" }).getByRole("tab")).toHaveCount(2);

  await page.getByRole("link", { name: "Home" }).click();
  await page.locator('input[type="file"]').setInputFiles([
    { name: "gstr1-april-2026.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(gstr1("042026", "15-04-2026", 3000, 270))) },
    { name: "gstr3b-april-2026.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(gstr3b("042026", 3000, 270))) },
  ]);
  await expect(page.getByText("2 documents ready")).toBeVisible();
  await page.getByRole("button", { name: "Run on 2 files" }).click();

  const gstinSearch = page.getByLabel("Search GSTIN");
  const gstinSelect = page.getByLabel("Client GSTIN");
  const yearSelect = page.getByLabel("Return year");
  await expect(gstinSelect).toHaveValue(gstin);
  await expect(yearSelect).toHaveValue("2026");
  await expect(yearSelect.locator("option")).toHaveText(["Select year", "2026", "2025"]);
  await yearSelect.selectOption("2025");
  await expect(page.getByRole("tablist", { name: "Reconciliation periods" }).getByRole("tab")).toHaveCount(2);
  await gstinSelect.selectOption("");
  await gstinSearch.fill("AEXPS3034");
  await expect(gstinSelect.locator("option")).toHaveText(["Select client GSTIN", gstin]);
  await gstinSearch.press("Enter");
  await expect(gstinSelect).toHaveValue(gstin);
  await expect(yearSelect).toHaveValue("2026");
  await expect(page).toHaveURL(new RegExp(`/reconciliations\\?gstin=${gstin}&year=2026`));
  await expect(page.getByRole("heading", { name: /Apr 2026/ })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export to Excel" }).click();
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

  await expect(page.locator(".gstin-cross-examination")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Resolve GSTIN mismatch" })).toBeDisabled();

  const gstr3bRow = page.getByRole("row").filter({ hasText: "client-b-gstr3b.json" });
  await gstr3bRow.getByRole("button", { name: "Modify mapping" }).click();
  await page.getByLabel("Client GSTIN").fill(clientAGstin);
  await page.getByRole("button", { name: "Save mapping" }).click();
  await expect(page.getByRole("button", { name: "Run on 2 files" })).toBeEnabled();
});

test("auditor decides whether incomplete source fields should be rendered as extracted", async ({ page }) => {
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
  await expect(tabPanel.getByRole("heading", { name: "Expected reconciliation fields were not mapped" })).toBeVisible();
  await expect(tabPanel.getByText("Ledger Ref", { exact: true })).toBeVisible();
  await expect(tabPanel.getByText("Party Label", { exact: true })).toBeVisible();
  await expect(tabPanel.locator(".missing-fields")).toHaveCSS("color", "rgb(154, 66, 66)");
  await expect(page.locator(".status-warning").first()).toHaveCSS("color", "rgb(154, 66, 66)");
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(tabPanel.locator(".missing-fields")).toHaveCSS("color", "rgb(237, 150, 150)");
  await expect(page.locator(".status-warning").first()).toHaveCSS("color", "rgb(237, 150, 150)");
  await page.screenshot({ path: path.join(root, "test-results/gst-render-prompt.png"), fullPage: true });

  await tabPanel.getByRole("button", { name: "Render original columns" }).click();
  await expect(tabPanel.getByRole("columnheader", { name: "Ledger Ref", exact: true })).toBeVisible();
  await expect(tabPanel.getByRole("cell", { name: "L-1001", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(root, "test-results/gst-original-fields-view.png"), fullPage: true });

  await tabPanel.getByRole("button", { name: "Hide table" }).click();
  await expect(tabPanel.getByRole("heading", { name: "Document fields are not being rendered" })).toBeVisible();
  await expect(tabPanel.getByRole("table")).toHaveCount(0);
  await tabPanel.getByRole("button", { name: "Render original columns" }).click();
  await expect(tabPanel.getByRole("columnheader", { name: "Tax Figure", exact: true })).toBeVisible();
});
