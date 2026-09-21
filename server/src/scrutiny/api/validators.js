import { AppError } from "../../errors.js";
import {
  AUDIT_REVIEW_DECISION_REQUEST_SCHEMA,
  CREATE_AUDIT_REPORT_REQUEST_SCHEMA,
  CREATE_AUDIT_RUN_REQUEST_SCHEMA,
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
  const normalized = plainObject(body) ? { ...body, name: typeof body.name === "string" ? body.name.trim() : body.name } : body;
  return validatedRequest(CREATE_AUDIT_REPORT_REQUEST_SCHEMA, normalized, "INVALID_AUDIT_REPORT", "Provide a report name and a consecutive YYYY-YYYY fiscal year.");
}

export function validateUploadAuditSourceMetadata(body) {
  return validatedRequest(UPLOAD_AUDIT_SOURCE_METADATA_SCHEMA, body, "INVALID_AUDIT_SOURCE_ROLE", "Choose a supported audit source role.");
}

export function validateCreateAuditRunRequest(body) {
  return validatedRequest(CREATE_AUDIT_RUN_REQUEST_SCHEMA, body, "INVALID_AUDIT_SELECTION", "Select source files and checks for this scrutiny run.");
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
