import { AppError } from "../../errors.js";
import { ERROR_CODES } from "../../api/errorCodes.js";
import {
  AUDIT_REVIEW_DECISION_REQUEST_SCHEMA,
  AUDIT_SUPPORTING_DOCUMENT_TYPES,
  CREATE_AUDIT_PROFILE_REQUEST_SCHEMA,
  CREATE_AUDIT_EXPORT_REQUEST_SCHEMA,
  CREATE_AUDIT_REPORT_REQUEST_SCHEMA,
  CREATE_AUDIT_RUN_REQUEST_SCHEMA,
  DERIVE_AUDIT_SOURCE_REQUEST_SCHEMA,
  SCRUTINY_RESPONSE_SCHEMAS,
  UPLOAD_AUDIT_SOURCE_METADATA_SCHEMA,
} from "./contracts.js";

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function issue(issues, path, message) {
  issues.push({ path, message });
}

// The service uses a deliberately small, explicit JSON Schema subset. Keeping
// one walker for request and response checks prevents their rules from drifting.
export function auditSchemaIssues(schema, value, path = "$", issues = []) {
  if (value === null && schema.nullable) return issues;
  if (schema.type === "object") {
    if (!plainObject(value)) {
      issue(issues, path, "must be an object");
      return issues;
    }
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) issue(issues, `${path}.${key}`, "is required");
    }
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties || {}, key)) {
        if (schema.additionalProperties === false) issue(issues, `${path}.${key}`, "is not allowed");
      } else {
        auditSchemaIssues(schema.properties[key], item, `${path}.${key}`, issues);
      }
    }
    return issues;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      issue(issues, path, "must be an array");
      return issues;
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) issue(issues, path, `must contain at least ${schema.minItems} item(s)`);
    if (schema.uniqueItems && new Set(value).size !== value.length) issue(issues, path, "must not contain duplicates");
    value.forEach((item, index) => auditSchemaIssues(schema.items, item, `${path}[${index}]`, issues));
    return issues;
  }
  if (schema.type === "integer") {
    if (!Number.isSafeInteger(value) || (schema.minimum !== undefined && value < schema.minimum)) {
      issue(issues, path, "must be a non-negative safe integer");
    }
    return issues;
  }
  if (schema.type === "boolean") {
    if (typeof value !== "boolean") issue(issues, path, "must be a boolean");
    return issues;
  }
  if (schema.type === "string") {
    if (typeof value !== "string") {
      issue(issues, path, "must be a string");
      return issues;
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) issue(issues, path, `must contain at least ${schema.minLength} character(s)`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) issue(issues, path, `must contain at most ${schema.maxLength} character(s)`);
    if (schema.enum && !schema.enum.includes(value)) issue(issues, path, "must be a supported value");
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) issue(issues, path, "has an invalid format");
    if (schema.format === "fiscal-year" && /^\d{4}-\d{4}$/.test(value)) {
      const [start, end] = value.split("-").map(Number);
      if (end !== start + 1) issue(issues, path, "must identify consecutive years");
    }
    if (schema.format === "date-time") {
      const parsed = new Date(value);
      const canonical = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
          || !canonical || (value !== canonical && value !== canonical.replace(/\.000Z$/, "Z"))) {
        issue(issues, path, "must be an ISO UTC timestamp");
      }
    }
    return issues;
  }
  throw new TypeError(`Unsupported scrutiny schema type: ${schema.type}`);
}

function validatedRequest(schema, body, code, message) {
  const issues = auditSchemaIssues(schema, body);
  if (issues.length) throw new AppError(400, code, message, { issues });
  return body;
}

export function validateCreateAuditReportRequest(body) {
  const normalized = plainObject(body) ? { ...body,
    name: typeof body.name === "string" ? body.name.trim() : body.name,
    ...(typeof body.taxpayerId === "string" ? { taxpayerId: body.taxpayerId.trim().toUpperCase() } : {}),
  } : body;
  return validatedRequest(CREATE_AUDIT_REPORT_REQUEST_SCHEMA, normalized, "INVALID_AUDIT_REPORT", "Provide a report name and a consecutive YYYY-YYYY fiscal year.");
}

export function validateUploadAuditSourceMetadata(body) {
  const normalized = plainObject(body) ? { ...body,
    ...(body.completeExport === "true" ? { completeExport: true }
      : body.completeExport === "false" ? { completeExport: false } : {}),
  } : body;
  const value = validatedRequest(UPLOAD_AUDIT_SOURCE_METADATA_SCHEMA, normalized,
    "INVALID_AUDIT_SOURCE_ROLE", "Choose a supported audit source role and completeness declaration.");
  if (value.documentType && value.role !== "supporting_document") {
    throw new AppError(400, ERROR_CODES.INVALID_AUDIT_SOURCE_ROLE,
      "Only supporting documents may include a supporting document type.", {
        issues: [{ path: "$.documentType", message: "is only valid for supporting documents" }],
      });
  }
  if (value.role === "supporting_document" && value.documentType &&
      !AUDIT_SUPPORTING_DOCUMENT_TYPES.includes(value.documentType)) {
    throw new AppError(400, ERROR_CODES.INVALID_AUDIT_SOURCE_ROLE, "Choose a supported supporting document type.", {
      issues: [{ path: "$.documentType", message: "must be a supported supporting document type" }],
    });
  }
  return value;
}

const profileFields = new Set(["voucherId", "ledger", "side", "amount", "date", "voucherType",
  "counterparty", "narration", "openingBalance", "debits", "credits", "closingBalance",
  "debit", "credit",
  "taxpayerId", "period", "reference", "incomeAmount", "incomeCategory", "taxableValue"]);
export const AUDIT_ACCOUNT_ROLES = Object.freeze(["sales", "business_receipts", "purchases", "gst_cash_igst",
  "gst_cash_cgst", "gst_cash_sgst", "gst_cash_cess", "gst_credit_igst",
  "gst_credit_cgst", "gst_credit_sgst", "gst_credit_cess", "tds_receivable",
  "tcs_receivable", "tds_payable", "interest_income", "interest_expense", "stock",
  "cash", "bank", "advance_tax", "gst_tds_payable", "loan", "secured_loan", "unsecured_loan",
  "professional_fees", "contractor", "rent", "commission", "other"]);

export function validateCreateAuditProfileRequest(body) {
  const normalized = plainObject(body) && typeof body.name === "string" ?
    { ...body, name: body.name.trim() } : body;
  validatedRequest(CREATE_AUDIT_PROFILE_REQUEST_SCHEMA, normalized, "INVALID_AUDIT_PROFILE",
    "Provide a profile name, books role, and mapping configuration.");
  const { configuration, role } = normalized;
  const errors = [];
  if (!["books_vouchers", "books_ledgers"].includes(role)) errors.push("Only books roles support ledger mapping profiles.");
  if (!plainObject(configuration)) errors.push("Configuration must be an object.");
  else {
    const allowed = new Set(["fields", "accountRoles", "recordsPath", "sheetNames",
      "headerRow", "layout", "sectionMarker", "ledgerNameColumn"]);
    for (const key of Object.keys(configuration)) if (!allowed.has(key)) errors.push(`Unknown configuration key: ${key}.`);
    if (configuration.fields !== undefined && !plainObject(configuration.fields)) errors.push("Field mappings must be an object.");
    if (configuration.accountRoles !== undefined && !plainObject(configuration.accountRoles)) errors.push("Account roles must be an object.");
    for (const [field, column] of Object.entries(configuration.fields || {})) {
      if (!profileFields.has(field) || typeof column !== "string" || !column.trim() || column.length > 160) {
        errors.push(`Invalid field mapping: ${field}.`);
      }
    }
    for (const [ledger, accountRole] of Object.entries(configuration.accountRoles || {})) {
      if (!ledger.trim() || ledger.length > 160 || !AUDIT_ACCOUNT_ROLES.includes(accountRole) ||
          ["__proto__", "constructor", "prototype"].includes(ledger)) errors.push(`Invalid account role: ${ledger}.`);
    }
    if (configuration.recordsPath !== undefined &&
        (typeof configuration.recordsPath !== "string" || configuration.recordsPath.length > 160 ||
          !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/.test(configuration.recordsPath))) {
      errors.push("The JSON records path is invalid.");
    }
    if (configuration.sheetNames !== undefined &&
        (!Array.isArray(configuration.sheetNames) || configuration.sheetNames.length > 20 ||
          configuration.sheetNames.some((name) => typeof name !== "string" || !name.trim() || name.length > 120))) {
      errors.push("Sheet names must be a list of at most 20 names.");
    }
    if (configuration.headerRow !== undefined && (!Number.isSafeInteger(configuration.headerRow) ||
        configuration.headerRow < 1 || configuration.headerRow > 1000)) errors.push("Header row must be 1 to 1000.");
    if (configuration.layout !== undefined && !["flat", "ledger_sections"].includes(configuration.layout)) {
      errors.push("Layout must be flat or ledger_sections.");
    }
    if (configuration.sectionMarker !== undefined && (typeof configuration.sectionMarker !== "string" ||
        !configuration.sectionMarker.trim() || configuration.sectionMarker.length > 80)) {
      errors.push("Section marker must be a short literal label.");
    }
    if (configuration.ledgerNameColumn !== undefined && (!Number.isSafeInteger(configuration.ledgerNameColumn) ||
        configuration.ledgerNameColumn < 0 || configuration.ledgerNameColumn > 100)) {
      errors.push("Ledger name column must be 0 to 100.");
    }
    if (JSON.stringify(configuration).length > 16_000) errors.push("Mapping configuration is too large.");
  }
  if (errors.length) throw new AppError(400, ERROR_CODES.INVALID_AUDIT_PROFILE, "Invalid mapping profile.",
    { issues: errors.map((message) => ({ path: "$.configuration", message })) });
  return normalized;
}

export function validateDeriveAuditSourceRequest(body) {
  return validatedRequest(DERIVE_AUDIT_SOURCE_REQUEST_SCHEMA, body, "AUDIT_SOURCE_INVALID",
    "Provide an existing source ID and completeness declaration.");
}

export function validateCreateAuditExportRequest(body) {
  return validatedRequest(CREATE_AUDIT_EXPORT_REQUEST_SCHEMA, body, "INVALID_AUDIT_SELECTION",
    "Choose completed runs and a supported export format and grouping.");
}

export function validateCreateAuditRunRequest(body) {
  const normalized = validatedRequest(CREATE_AUDIT_RUN_REQUEST_SCHEMA, body,
    "INVALID_AUDIT_SELECTION", "Select source files and checks for this scrutiny run.");
  const duplicateVoucherMinAmount = normalized.parameters?.duplicateVoucherMinAmount;
  if (duplicateVoucherMinAmount !== undefined && !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(duplicateVoucherMinAmount)) {
    throw new AppError(400, ERROR_CODES.INVALID_AUDIT_SELECTION,
      "Scrutiny run parameters must use nonnegative decimal rupee strings with at most two paise digits.", {
        issues: [{ path: "$.parameters.duplicateVoucherMinAmount", message: "must be a nonnegative decimal amount" }],
      });
  }
  return normalized;
}

export function validateAuditReviewDecisionRequest(body) {
  const normalized = plainObject(body) && typeof body.note === "string" ? { ...body, note: body.note.trim() } : body;
  return validatedRequest(AUDIT_REVIEW_DECISION_REQUEST_SCHEMA, normalized, "INVALID_AUDIT_DECISION", "Choose a supported reviewer decision.");
}

export function validateScrutinyResponse(schemaName, payload) {
  const schema = SCRUTINY_RESPONSE_SCHEMAS[schemaName];
  if (!schema) throw new TypeError(`Unknown scrutiny response schema: ${schemaName}`);
  const issues = auditSchemaIssues(schema, payload);
  if (issues.length) throw new TypeError(`Invalid ${schemaName} response: ${issues.map(({ path, message }) => `${path} ${message}`).join("; ")}`);
  return payload;
}
