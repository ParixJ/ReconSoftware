import { getDb, closeDb } from "../src/db/database.js";
import { writeTransaction } from "../src/db/transactions.js";
import { createDocuments } from "../src/sales_recon/services/documentService.js";

// An actual second server process, configured against the test's SQLite file.
getDb();
process.send({ type: "ready" });
process.once("message", async (input) => {
  try {
    if (input.action === "hold") {
      writeTransaction(getDb(), (db) => {
        db.prepare("UPDATE users SET name = ? WHERE id = ?").run("Committed writer", input.userId);
        process.send({ type: "locked" });
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, input.duration);
      });
      process.send({ type: "result", success: true });
    } else {
      const result = await createDocuments(input.userId, input.files);
      process.send({ type: "result", success: true, count: result.documents.length });
    }
  } catch (error) {
    process.send({ type: "result", success: false, code: error.code, message: error.message });
  } finally {
    closeDb();
    // The parent may be blocked waiting for SQLite. Remain alive until receipt.
    process.once("message", () => process.disconnect());
  }
});
