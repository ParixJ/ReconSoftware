import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.NODE_ENV = "test";
process.env.GST_DATA_DIR = path.join(root, "server/data/e2e-data");
process.env.GST_DATABASE_PATH = path.join(root, "server/data/e2e-data/gst-e2e.sqlite");
process.env.GST_UPLOAD_DIR = path.join(root, "server/data/e2e-data/uploads");

let apiServer;
let closeDatabase;

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

test("auditor uploads three returns, reviews mapping, and reconciles", async ({ page }) => {
  const email = `auditor-${Date.now()}@example.test`;
  await page.goto("/auth");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("Playwright Auditor");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("safe-password-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "GST return reconciliation" })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles([
    path.join(root, "sample-docs/gstr1-march-2026.json"),
    path.join(root, "sample-docs/gstr3b-march-2026.json"),
    path.join(root, "docs/returns_R2B_24AEXPS3034H1Z6_032026.json"),
  ]);
  await expect(page.getByText("3 documents ready")).toBeVisible();
  await expect(page.getByRole("cell", { name: "GSTR-1", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "GSTR-3B", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "GSTR-2B", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Modify mapping" }).first().click();
  await expect(page.getByRole("heading", { name: "Return identity" })).toBeVisible();
  await expect(page.getByText("Official GST schema recognized")).toBeVisible();
  await page.screenshot({ path: path.join(root, "test-results/gst-mapping-page.png"), fullPage: true });
  await page.getByRole("button", { name: "Back to reconciliation" }).click();

  await page.getByRole("button", { name: "Run on 3 files" }).click();
  await expect(page.getByText("Reconciliation needs review")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Mar 2026/ })).toBeVisible();
  await expect(page.getByText("20 / 23")).toBeVisible();
  await expect(page.getByText("Suggested review sequence")).toBeVisible();
  await page.screenshot({ path: path.join(root, "test-results/gst-reconciliation-flow.png"), fullPage: true });

  const gstr1Row = page.getByRole("row").filter({ hasText: "gstr1-march-2026.json" });
  page.once("dialog", (dialog) => dialog.accept());
  await gstr1Row.getByRole("button", { name: "Delete gstr1-march-2026.json" }).click();
  await expect(page.getByText("Document deleted")).toBeVisible();
  await expect(gstr1Row).toHaveCount(0);
});

test("auditor decides whether incomplete source fields should be rendered as extracted", async ({ page }) => {
  const email = `mapping-auditor-${Date.now()}@example.test`;
  await page.goto("/auth");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("Mapping Auditor");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("safe-password-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "GST return reconciliation" })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles(path.join(root, "sample-docs/unmapped-ledger.csv"));
  const tabPanel = page.getByRole("tabpanel");
  await expect(tabPanel.getByRole("heading", { name: "Expected reconciliation fields were not mapped" })).toBeVisible();
  await expect(tabPanel.getByText("Ledger Ref", { exact: true })).toBeVisible();
  await expect(tabPanel.getByText("Party Label", { exact: true })).toBeVisible();
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
