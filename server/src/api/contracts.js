import { ERROR_CODES, EXCEPTION_CODES } from "./errorCodes.js";

export { ERROR_CODES, EXCEPTION_CODES };

export const ERROR_RESPONSE_SCHEMA = Object.freeze({
  type: "object",
  required: ["error"],
  additionalProperties: false,
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      additionalProperties: false,
      properties: {
        code: { type: "string", enum: Object.values(ERROR_CODES) },
        message: { type: "string" },
        details: {},
      },
    },
  },
});

export const DOCUMENT_TYPES = Object.freeze(["gstr1", "gstr2", "gstr2b", "gstr3b", "salesRegister", "unknown"]);

export const CANONICAL_FIELDS = Object.freeze([
  "counterpartyGstin",
  "tradeName",
  "invoiceNumber",
  "invoiceDate",
  "invoiceValue",
  "taxableValue",
  "placeOfSupply",
  "reverseCharge",
  "igst",
  "cgst",
  "sgst",
  "cess",
]);

export const API_CONTRACTS = Object.freeze({
  auth: ["POST /api/auth/register", "POST /api/auth/login", "GET /api/auth/me", "POST /api/auth/logout"],
  documentOriginal: ["GET /api/sales/document-org/:id"],
  documents: ["GET /api/sales/documents", "POST /api/sales/documents/upload", "GET /api/sales/documents/:id", "DELETE /api/sales/documents", "PUT /api/sales/documents/gstin", "DELETE /api/sales/documents/:id", "PUT /api/sales/documents/:id/mapping", "PUT /api/sales/documents/:id/view-preference"],
  reconciliations: ["GET /api/sales/reconciliations", "GET /api/sales/reconciliations/export", "GET /api/sales/reconciliations/export-data", "GET /api/sales/reconciliations/:id", "POST /api/sales/reconciliations", "POST /api/sales/reconciliations/export", "DELETE /api/sales/reconciliations/:id"],
});
