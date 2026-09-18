import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { ERROR_CODES, EXCEPTION_CODES } from "../src/api/errorCodes.js";
import { AppError } from "../src/errors.js";
import { errorHandler } from "../src/middleware/errorHandler.js";
import { ERROR_RESPONSE_SCHEMA } from "../src/api/contracts.js";

process.env.NODE_ENV = "test";

function responseFor(error) {
  let status, body;
  errorHandler(error, {}, { status(value) { status = value; return this; }, json(value) { body = value; } }, () => {});
  return { status, body };
}

test("expected errors retain their wire code, message and details", () => {
  const details = { limit: 100 };
  assert.deepEqual(responseFor(new AppError(400, ERROR_CODES.DOCUMENT_STORAGE_LIMIT_EXCEEDED, "Storage is full.", details)), {
    status: 400, body: { error: { code: "DOCUMENT_STORAGE_LIMIT_EXCEEDED", message: "Storage is full.", details } },
  });
  assert.deepEqual(ERROR_RESPONSE_SCHEMA.properties.error.properties.code.enum, Object.values(ERROR_CODES));
});

test("unexpected failures do not expose dependency codes or messages", () => {
  const response = responseFor(Object.assign(new Error("private database path"), { code: "SQLITE_ERROR" }));
  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, ERROR_CODES.INTERNAL_ERROR);
  assert.ok(!response.body.error.message.includes("private"));
});

test("Multer and JSON body errors use defined codes", () => {
  assert.equal(responseFor(new multer.MulterError("LIMIT_FILE_SIZE")).body.error.code, ERROR_CODES.LIMIT_FILE_SIZE);
  assert.equal(responseFor(new multer.MulterError("LIMIT_FILE_COUNT")).body.error.code, ERROR_CODES.LIMIT_FILE_COUNT);
  assert.equal(responseFor(new multer.MulterError("LIMIT_UNEXPECTED_FILE")).body.error.code, ERROR_CODES.LIMIT_UNEXPECTED_FILE);
  assert.equal(responseFor(new multer.MulterError("FUTURE_CODE")).body.error.code, ERROR_CODES.UPLOAD_FAILED);
  assert.equal(responseFor({ type: "entity.parse.failed" }).body.error.code, ERROR_CODES.INVALID_REQUEST_BODY);
  assert.equal(responseFor({ type: "entity.too.large" }).status, 413);
  assert.equal(responseFor({ errcode: 5 }).body.error.code, ERROR_CODES.DATABASE_WRITE_BUSY);
});

test("server source references only registered codes and adds no literal AppError codes", () => {
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  for (const entry of fs.readdirSync(root, { recursive: true })) {
    if (!entry.endsWith(".js")) continue;
    const source = fs.readFileSync(path.join(root, entry), "utf8");
    for (const [, name] of source.matchAll(/ERROR_CODES\.([A-Z0-9_]+)/g)) assert.ok(Object.hasOwn(ERROR_CODES, name), `${entry}: ${name}`);
    for (const [, name] of source.matchAll(/EXCEPTION_CODES\.([A-Z0-9_]+)/g)) assert.ok(Object.hasOwn(EXCEPTION_CODES, name), `${entry}: ${name}`);
    assert.ok(!/new AppError\(\s*\d+\s*,\s*["']/.test(source), `${entry}: use the shared catalog`);
  }
});
