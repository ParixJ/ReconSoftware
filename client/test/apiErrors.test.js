import test from "node:test";
import assert from "node:assert/strict";
import { ERROR_CODES, CLIENT_ERROR_CODES, errorCode, errorMessage } from "../src/api/errors.js";

test("server errors preserve existing codes and contextual messages", () => {
  const error = { response: { data: { error: { code: "INVALID_GSTIN", message: "Correct the GSTIN." } } }, code: "ERR_BAD_REQUEST" };
  assert.equal(errorCode(error), ERROR_CODES.INVALID_GSTIN);
  assert.equal(errorMessage(error), "Correct the GSTIN.");
});

test("transport errors have stable client codes without replacing server responses", () => {
  assert.equal(errorCode({ code: "ERR_NETWORK" }), CLIENT_ERROR_CODES.NETWORK_ERROR);
  assert.equal(errorCode({ code: "ECONNABORTED" }), CLIENT_ERROR_CODES.REQUEST_TIMEOUT);
  assert.equal(errorCode({ code: "ETIMEDOUT" }), CLIENT_ERROR_CODES.REQUEST_TIMEOUT);
  assert.equal(errorCode({ code: "ERR_CANCELED" }), CLIENT_ERROR_CODES.REQUEST_CANCELLED);
  assert.equal(errorCode({ response: { status: 502 }, request: {} }), CLIENT_ERROR_CODES.REQUEST_FAILED);
  assert.equal(errorMessage(null, "Upload failed."), "Upload failed.");
});
