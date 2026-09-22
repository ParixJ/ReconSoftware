import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let testDataDir;
let apiServer;
let viteServer;
let closeDatabase;
let webOrigin;

test.beforeAll(async () => {
  testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "scrutiny-e2e-"));
  process.env.NODE_ENV = "test";
  process.env.GST_DATA_DIR = testDataDir;
  process.env.GST_DATABASE_PATH = path.join(testDataDir, "audit.sqlite");
  process.env.GST_UPLOAD_DIR = path.join(testDataDir, "sales-uploads");
  process.env.AUDIT_UPLOAD_DIR = path.join(testDataDir, "audit-uploads");
  const [{ createApp }, { closeDb }] = await Promise.all([
    import("../server/src/app.js"), import("../server/src/db/database.js"),
  ]);
  closeDatabase = closeDb;
  apiServer = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => apiServer.once("listening", resolve));
  const probe = net.createServer().listen(0, "127.0.0.1");
  await new Promise((resolve) => probe.once("listening", resolve));
  const webPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  viteServer = await createServer({
    root: path.join(root, "client"),
    configFile: path.join(root, "client", "vite.config.js"),
    configLoader: "runner",
    cacheDir: path.join(testDataDir, "vite-cache"),
    server: { host: "127.0.0.1", port: webPort, strictPort: true,
      proxy: { "/api": `http://127.0.0.1:${apiServer.address().port}` } },
  });
  await viteServer.listen();
  webOrigin = `http://127.0.0.1:${viteServer.httpServer.address().port}`;
});

test.afterAll(async () => {
  try {
    await viteServer?.close();
    if (apiServer) await new Promise((resolve) => {
      apiServer.close(resolve);
      apiServer.closeAllConnections?.();
    });
  } finally {
    closeDatabase?.();
    if (testDataDir) fs.rmSync(testDataDir, { recursive: true, force: true });
  }
});

test("auditor creates a scrutiny report, runs a check, and records a review", async ({ page }) => {
  await page.goto(`${webOrigin}/auth`);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Full name").fill("Scrutiny Auditor");
  await page.getByLabel("Email address").fill(`scrutiny-${Date.now()}@example.test`);
  await page.getByLabel("Password").fill("safe-password-2026");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("link", { name: "Audit reports" }).click();
  await expect(page.getByRole("heading", { name: "Audit reports" })).toBeVisible();

  await page.getByLabel("Report name").fill("Synthetic FY audit");
  await page.getByLabel("Fiscal year").fill("2025-2026");
  await page.getByLabel("Taxpayer ID (optional)").fill("ABCDE1234F");
  await page.getByRole("button", { name: "Create report" }).click();
  await expect(page.getByRole("heading", { name: "Synthetic FY audit" })).toBeVisible();

  await page.getByLabel("File", { exact: true }).setInputFiles(
    path.join(root, "docs", "scrutiny-demo", "books_vouchers.json"),
  );
  await page.getByRole("checkbox", { name: "Complete export for the period" }).check();
  await page.getByRole("button", { name: "Upload source" }).click();
  await expect(page.getByRole("checkbox", { name: "Select books_vouchers.json for run" })).toBeVisible();
  await page.getByRole("checkbox", { name: "Select books_vouchers.json for run" }).check();
  await page.getByRole("checkbox", { name: /B01.*Voucher balance/ }).check();
  await page.getByRole("button", { name: "Run selected checks" }).click();
  await expect(page.getByText("1 voucher(s) balance.")).toBeVisible();
  await page.getByLabel("Decision").selectOption("confirmed");
  await page.getByLabel("Reviewer note").fill("Voucher postings inspected.");
  await page.getByRole("button", { name: "Save decision" }).click();
  await expect(page.getByText(/Current decision: Confirmed/)).toBeVisible();
});
