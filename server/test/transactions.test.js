import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { writeTransaction } from "../src/db/transactions.js";
import { ERROR_CODES } from "../src/api/errorCodes.js";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "recon-atomic-"));
process.env.NODE_ENV = "test";
process.env.GST_DATA_DIR = testRoot;
process.env.GST_DATABASE_PATH = path.join(testRoot, "atomic.sqlite");
process.env.GST_UPLOAD_DIR = path.join(testRoot, "uploads");
const { getDb, closeDb } = await import("../src/db/database.js");
const { createDocuments, deleteDocument, updateDocumentsGstin } = await import("../src/sales_recon/services/documentService.js");
fs.mkdirSync(process.env.GST_UPLOAD_DIR, { recursive: true });

function seedUser(id) {
  writeTransaction(getDb(), (db) => db.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?)").run(id, `${id}@example.test`, id, "unused", "2025-01-01"));
}

function seedDocument(userId, id, parsed = { documentType: "gstr1", builtInSchema: true, rows: [], anomalies: [], summary: {}, sourceFields: [] }) {
  getDb().prepare(`INSERT INTO documents
    (id, user_id, original_name, stored_name, file_type, document_type, status, parsed_data, mapping, created_at)
    VALUES (?, ?, ?, ?, 'json', 'gstr1', 'ready', ?, ?, '2025-01-01')`)
    .run(id, userId, `${id}.json`, id, JSON.stringify(parsed), JSON.stringify({ documentType: "gstr1", gstin: null, returnPeriod: "042025", fieldMap: {} }));
}

function uploadFile(filename) {
  const filePath = path.join(process.env.GST_UPLOAD_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify({ documentType: "gstr1", gstin: "24AEXPS3034H1Z6", returnPeriod: "042025", rows: [{ invoiceNumber: "A", taxableValue: 100, igst: 18 }] }));
  return { filename, path: filePath, originalname: `${filename}.json`, mimetype: "application/json" };
}

function waitMessage(child, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`Timed out waiting for ${type}`)), 15000);
    const onMessage = (message) => {
      if (message.type === type) {
        if (type === "result" && child.connected) child.send({ type: "ack" });
        finish(null, message);
      }
    };
    const onExit = (code) => finish(new Error(`Worker exited before ${type}: ${code}`));
    const finish = (error, value) => {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
      error ? reject(error) : resolve(value);
    };
    const onError = (error) => finish(error);
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function serverInstance(t) {
  const child = fork(new URL("../testFixtures/concurrentWrite.js", import.meta.url), [], { env: process.env, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let diagnostics = "";
  child.stderr.on("data", (chunk) => { diagnostics += chunk; });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  try { await waitMessage(child, "ready"); }
  catch (error) { throw new Error(`${error.message}: ${diagnostics}`); }
  return child;
}

test.after(() => { closeDb(); fs.rmSync(testRoot, { recursive: true, force: true }); });

test("write transactions roll back all statements and nested savepoints", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE values_test(value INTEGER)");
    assert.throws(() => writeTransaction(db, () => {
      db.prepare("INSERT INTO values_test VALUES (1)").run();
      writeTransaction(db, () => db.prepare("INSERT INTO values_test VALUES (2)").run());
      throw new Error("rollback");
    }), /rollback/);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM values_test").get().count, 0);
    writeTransaction(db, () => {
      db.prepare("INSERT INTO values_test VALUES (3)").run();
      assert.throws(() => writeTransaction(db, () => {
        db.prepare("INSERT INTO values_test VALUES (4)").run();
        throw new Error("nested rollback");
      }));
    });
    assert.deepEqual(db.prepare("SELECT value FROM values_test").all().map((row) => row.value), [3]);
    assert.throws(() => writeTransaction(db, async () => {}), /synchronous/);
    assert.equal(db.isTransaction, false);
  } finally { db.close(); }
});

test("separate server instances cannot overfill the same account", async (t) => {
  seedUser("quota");
  writeTransaction(getDb(), () => { for (let i = 0; i < 99; i++) seedDocument("quota", `quota-${i}`); });
  const files = [uploadFile("competing-a"), uploadFile("competing-b")];
  const instances = await Promise.all([serverInstance(t), serverInstance(t)]);
  const results = instances.map((child) => waitMessage(child, "result"));
  instances.forEach((child, index) => child.send({ action: "upload", userId: "quota", files: [files[index]] }));
  const completed = await Promise.all(results);
  assert.equal(completed.filter((item) => item.success).length, 1);
  assert.equal(completed.find((item) => !item.success).code, ERROR_CODES.DOCUMENT_STORAGE_LIMIT_EXCEEDED);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM documents WHERE user_id = 'quota'").get().count, 100);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM document_org WHERE user_id = 'quota'").get().count, 1);
  const rejectedIndex = completed.findIndex((item) => !item.success);
  assert.equal(fs.existsSync(files[rejectedIndex].path), false);
});

test("another process owns the writer lock; readers see committed data and timeout is typed", async (t) => {
  seedUser("locked");
  const child = await serverInstance(t);
  const locked = waitMessage(child, "locked"), done = waitMessage(child, "result");
  child.send({ action: "hold", userId: "locked", duration: 700 });
  await locked;
  const db = getDb();
  db.exec("PRAGMA busy_timeout = 50");
  try {
    assert.equal(db.prepare("SELECT name FROM users WHERE id = 'locked'").get().name, "locked");
    assert.throws(() => writeTransaction(db, () => db.prepare("UPDATE users SET name = 'competing' WHERE id = 'locked'").run()), (error) => error.status === 409 && error.code === ERROR_CODES.DATABASE_WRITE_BUSY);
    assert.equal(db.isTransaction, false);
  } finally { db.exec("PRAGMA busy_timeout = 5000"); }
  // The competing process commits independently while this connection waits.
  writeTransaction(db, () => {
    assert.equal(db.prepare("SELECT name FROM users WHERE id = 'locked'").get().name, "Committed writer");
    db.prepare("UPDATE users SET name = 'next writer' WHERE id = 'locked'").run();
  });
  assert.equal((await done).success, true);
  assert.equal(db.prepare("SELECT name FROM users WHERE id = 'locked'").get().name, "next writer");
});

test("an insertion failure rolls back the entire batch and its original metadata", async () => {
  seedUser("batch");
  getDb().exec("CREATE TRIGGER reject_batch BEFORE INSERT ON document_org WHEN NEW.user_id = 'batch' AND (SELECT COUNT(*) FROM document_org WHERE user_id = 'batch') > 0 BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  const files = [uploadFile("batch-a"), uploadFile("batch-b")];
  try { await assert.rejects(createDocuments("batch", files), /test failure/); }
  finally { getDb().exec("DROP TRIGGER reject_batch"); }
  assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM documents WHERE user_id = 'batch'").get().count, 0);
  assert.equal(getDb().prepare("SELECT COUNT(*) AS count FROM document_org WHERE user_id = 'batch'").get().count, 0);
  assert.ok(files.every((file) => !fs.existsSync(file.path)));
});

test("bulk mapping rolls back earlier updates if a later document fails", () => {
  seedUser("mapping");
  writeTransaction(getDb(), () => { seedDocument("mapping", "mapping-a"); seedDocument("mapping", "mapping-b", null); });
  assert.throws(() => updateDocumentsGstin("mapping", { documentIds: ["mapping-a", "mapping-b"], gstin: "24AEXPS3034H1Z6" }), (error) => error.code === ERROR_CODES.PARSED_DATA_MISSING);
  assert.equal(getDb().prepare("SELECT gstin FROM documents WHERE id = 'mapping-a'").get().gstin, null);
});

test("deletion rollback restores the uploaded file and keeps metadata", async () => {
  seedUser("delete");
  writeTransaction(getDb(), () => seedDocument("delete", "delete-a"));
  const file = uploadFile("delete-a");
  getDb().exec("CREATE TRIGGER reject_delete BEFORE DELETE ON documents WHEN OLD.user_id = 'delete' BEGIN SELECT RAISE(ABORT, 'delete failure'); END");
  try { await assert.rejects(deleteDocument("delete", "delete-a"), /delete failure/); }
  finally { getDb().exec("DROP TRIGGER reject_delete"); }
  assert.equal(fs.existsSync(file.path), true);
  assert.ok(getDb().prepare("SELECT 1 FROM documents WHERE id = 'delete-a'").get());
  assert.ok(!fs.readdirSync(process.env.GST_UPLOAD_DIR).some((name) => name.includes(".deleting-")));
});
