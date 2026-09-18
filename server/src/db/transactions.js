import { AppError } from "../errors.js";
import { ERROR_CODES } from "../api/errorCodes.js";

let nextSavepoint = 0;

export function isDatabaseBusy(error) {
  return [5, 6].includes(Number(error?.errcode) & 255)
    || ["SQLITE_BUSY", "SQLITE_LOCKED"].includes(error?.code);
}

// Callbacks must be synchronous: parsing/network awaits must finish before entry.
// The SQLite lock, rather than an in-process mutex, coordinates separate servers.
export function writeTransaction(db, work) {
  if (work.constructor.name === "AsyncFunction") {
    throw new TypeError("Write transaction callbacks must be synchronous.");
  }
  const nested = db.isTransaction;
  const savepoint = `write_${++nextSavepoint}`;
  let started = false;
  try {
    db.exec(nested ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
    started = true;
    const result = work(db);
    if (result && typeof result.then === "function") {
      throw new TypeError("Write transaction callbacks must not return promises.");
    }
    db.exec(nested ? `RELEASE SAVEPOINT ${savepoint}` : "COMMIT");
    return result;
  } catch (error) {
    if (started && db.isTransaction) {
      db.exec(nested ? `ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}` : "ROLLBACK");
    }
    if (isDatabaseBusy(error)) {
      throw new AppError(409, ERROR_CODES.DATABASE_WRITE_BUSY, "Another write is in progress. Wait and try again.");
    }
    throw error;
  }
}
