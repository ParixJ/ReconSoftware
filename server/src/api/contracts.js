export const DOCUMENT_TYPES = Object.freeze(["gstr1", "gstr2", "gstr2b", "gstr3b", "unknown"]);

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
  documents: ["GET /api/documents", "POST /api/documents/upload", "GET /api/documents/:id", "PUT /api/documents/:id/mapping", "PUT /api/documents/:id/view-preference"],
  reconciliations: ["GET /api/reconciliations", "GET /api/reconciliations/:id", "POST /api/reconciliations"],
});
