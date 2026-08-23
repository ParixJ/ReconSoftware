import crypto from "node:crypto";
import { getDb } from "../db/database.js";
import { AppError } from "../errors.js";
import { rowsForReconciliation } from "./documentService.js";
import { addMoney, asNumber, emptyMoney, jsonSafeParse } from "../parsers/utils.js";

const LIABILITY_DEFINITIONS = [
  { category: "taxableOutward", table: "3.1(a)", label: "Taxable outward supplies", measures: ["taxableValue", "igst", "cgst", "sgst", "cess"] },
  { category: "zeroRated", table: "3.1(b)", label: "Zero-rated outward supplies", measures: ["taxableValue", "igst", "cgst", "sgst", "cess"] },
  { category: "nilExempt", table: "3.1(c)", label: "Nil-rated and exempt outward supplies", measures: ["taxableValue"] },
  { category: "nonGst", table: "3.1(e)", label: "Non-GST outward supplies", measures: ["taxableValue"] },
  { category: "interStateUnregistered", table: "3.2", label: "Inter-state supplies to unregistered persons", measures: ["taxableValue", "igst"] },
];

const MEASURE_LABELS = {
  taxableValue: "Taxable value",
  igst: "IGST",
  cgst: "CGST",
  sgst: "SGST / UTGST",
  cess: "Cess",
};

function aggregateSummary(documents, category) {
  const total = emptyMoney();
  for (const document of documents) addMoney(total, document.parsed.summary?.[category] || {});
  return total;
}

function comparison({ table, label, measure, left, right, tolerance, kind = "liability" }) {
  const difference = asNumber(left) - asNumber(right);
  const matched = Math.abs(difference) <= tolerance;
  let risk = "none";
  let suggestion = "Values agree within the configured tolerance.";
  if (!matched && kind === "liability" && difference > 0) {
    risk = "high";
    suggestion = "GSTR-1 is higher. Review omitted or under-reported liability in GSTR-3B and retain support for any valid adjustment.";
  } else if (!matched && kind === "liability") {
    risk = "medium";
    suggestion = "GSTR-3B is higher. Review missing GSTR-1 invoices, amendments, credit notes, and classification.";
  } else if (!matched && kind === "itc" && difference < 0) {
    risk = "high";
    suggestion = "Claimed ITC exceeds GSTR-2B availability. Check reversals, duplicate claims, and eligibility before filing.";
  } else if (!matched && kind === "itc") {
    risk = "medium";
    suggestion = "Available ITC exceeds the claim. Check deferred credits, reversals, imports, and timing differences.";
  }
  return {
    id: `${table}-${measure}`,
    table,
    label,
    measure,
    measureLabel: MEASURE_LABELS[measure],
    sourceValue: asNumber(left),
    filedValue: asNumber(right),
    difference,
    status: matched ? "matched" : "mismatch",
    risk,
    suggestion,
    kind,
  };
}

function parseInvoiceDate(value) {
  const parts = String(value || "").match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return parts ? new Date(Date.UTC(Number(parts[3]), Number(parts[2]) - 1, Number(parts[1]))) : null;
}

function periodBounds(period, toleranceDays) {
  if (!/^(0[1-9]|1[0-2])\d{4}$/.test(period || "")) return null;
  const month = Number(period.slice(0, 2)) - 1;
  const year = Number(period.slice(2));
  const delta = toleranceDays * 86400000;
  return { start: new Date(Date.UTC(year, month, 1) - delta), end: new Date(Date.UTC(year, month + 1, 0) + delta) };
}

function identityExceptions(documents) {
  const exceptions = [];
  const gstins = [...new Set(documents.map((document) => document.gstin).filter(Boolean))];
  const periods = [...new Set(documents.map((document) => document.returnPeriod).filter(Boolean))];
  if (gstins.length > 1) exceptions.push({ code: "GSTIN_MISMATCH", severity: "error", message: `Selected documents contain different client GSTINs: ${gstins.join(", ")}.`, suggestion: "Remove the unrelated file or correct its client GSTIN in Modify mapping." });
  if (periods.length > 1) exceptions.push({ code: "PERIOD_MISMATCH", severity: "error", message: `Selected documents contain different periods: ${periods.join(", ")}.`, suggestion: "Reconcile one return period at a time or correct the period in Modify mapping." });
  for (const document of documents) {
    for (const item of document.anomalies || []) exceptions.push({ ...item, documentId: document.id, documentName: document.originalName });
  }
  return exceptions;
}

function dateExceptions(documents, toleranceDays) {
  const exceptions = [];
  for (const document of documents.filter((item) => item.documentType === "gstr1")) {
    const bounds = periodBounds(document.returnPeriod, toleranceDays);
    if (!bounds) continue;
    document.parsed.rows.forEach((row, rowIndex) => {
      const date = parseInvoiceDate(row.invoiceDate);
      if (date && (date < bounds.start || date > bounds.end)) {
        exceptions.push({
          code: "INVOICE_OUTSIDE_PERIOD",
          severity: "warning",
          documentId: document.id,
          documentName: document.originalName,
          rowIndex,
          message: `Invoice ${row.invoiceNumber || rowIndex + 1} is outside ${document.returnPeriod} beyond the ${toleranceDays}-day tolerance.`,
          suggestion: "Confirm whether this is a valid amendment/timing item or correct the invoice date mapping.",
        });
      }
    });
  }
  return exceptions;
}

function serialize(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    documentIds: jsonSafeParse(row.selected_document_ids, []),
    amountTolerance: row.amount_tolerance,
    dateToleranceDays: row.date_tolerance_days,
    result: jsonSafeParse(row.result_json, {}),
    createdAt: row.created_at,
  };
}

export function runReconciliation(userId, input) {
  const documentIds = [...new Set(Array.isArray(input.documentIds) ? input.documentIds.map(String) : [])];
  if (documentIds.length < 2 || documentIds.length > 10) throw new AppError(400, "INVALID_SELECTION", "Select between 2 and 10 documents to reconcile.");
  const amountTolerance = Number(input.amountTolerance ?? 1);
  const dateToleranceDays = Number(input.dateToleranceDays ?? 0);
  if (!Number.isFinite(amountTolerance) || amountTolerance < 0 || amountTolerance > 1000000) throw new AppError(400, "INVALID_AMOUNT_TOLERANCE", "Amount tolerance must be between ₹0 and ₹10,00,000.");
  if (!Number.isInteger(dateToleranceDays) || dateToleranceDays < 0 || dateToleranceDays > 90) throw new AppError(400, "INVALID_DATE_TOLERANCE", "Date tolerance must be a whole number from 0 to 90 days.");

  const documents = rowsForReconciliation(userId, documentIds);
  const gstr1 = documents.filter((item) => item.documentType === "gstr1");
  const gstr3b = documents.filter((item) => item.documentType === "gstr3b");
  const gstr2b = documents.filter((item) => item.documentType === "gstr2b" || item.documentType === "gstr2");
  if (!gstr1.length || !gstr3b.length) {
    throw new AppError(422, "REQUIRED_RETURNS_MISSING", "Select at least one GSTR-1 and one GSTR-3B document. GSTR-2B is optional for ITC checks.");
  }

  const comparisons = [];
  for (const definition of LIABILITY_DEFINITIONS) {
    const source = aggregateSummary(gstr1, definition.category);
    const filed = aggregateSummary(gstr3b, definition.category);
    for (const measure of definition.measures) comparisons.push(comparison({
      table: definition.table,
      label: definition.label,
      measure,
      left: source[measure],
      right: filed[measure],
      tolerance: amountTolerance,
    }));
  }
  if (gstr2b.length) {
    const reverseChargeSource = aggregateSummary(gstr2b, "reverseCharge");
    const reverseChargeFiled = aggregateSummary(gstr3b, "reverseCharge");
    for (const measure of ["taxableValue", "igst", "cgst", "sgst", "cess"]) comparisons.push(comparison({
      table: "3.1(d)", label: "Inward supplies liable to reverse charge", measure,
      left: reverseChargeSource[measure], right: reverseChargeFiled[measure], tolerance: amountTolerance,
    }));
    const available = aggregateSummary(gstr2b, "itcAvailable");
    addMoney(available, reverseChargeSource);
    const claimed = aggregateSummary(gstr3b, "itcClaimed");
    for (const measure of ["igst", "cgst", "sgst", "cess"]) comparisons.push(comparison({
      table: "4(A)", label: "Input tax credit", measure,
      left: available[measure], right: claimed[measure], tolerance: amountTolerance, kind: "itc",
    }));
  }

  const exceptions = [...identityExceptions(documents), ...dateExceptions(documents, dateToleranceDays)];
  const mismatches = comparisons.filter((item) => item.status === "mismatch");
  const highRisk = mismatches.filter((item) => item.risk === "high").length + exceptions.filter((item) => item.severity === "error").length;
  const suggestions = [...new Set([...mismatches.map((item) => item.suggestion), ...exceptions.map((item) => item.suggestion).filter(Boolean)])];
  const result = {
    clientGstin: documents.map((item) => item.gstin).find(Boolean) || null,
    returnPeriod: documents.map((item) => item.returnPeriod).find(Boolean) || null,
    documents: documents.map((item) => ({ id: item.id, originalName: item.originalName, documentType: item.documentType, gstin: item.gstin, returnPeriod: item.returnPeriod, recordCount: item.recordCount })),
    summary: {
      totalChecks: comparisons.length,
      matched: comparisons.length - mismatches.length,
      mismatched: mismatches.length,
      exceptions: exceptions.length,
      highRisk,
      totalAbsoluteDifference: mismatches.reduce((sum, item) => sum + Math.abs(item.difference), 0),
    },
    comparisons,
    exceptions,
    suggestions,
    methodology: "GSTR-1 liability tables mapped to GSTR-3B 3.1(a/b/c/e); optional GSTR-2B ITC mapped to GSTR-3B 4(A).",
  };
  const status = mismatches.length || exceptions.length ? "needs_review" : "matched";
  const row = {
    id: crypto.randomUUID(), user_id: userId, selected_document_ids: JSON.stringify(documentIds),
    amount_tolerance: amountTolerance, date_tolerance_days: dateToleranceDays, status,
    result_json: JSON.stringify(result), created_at: new Date().toISOString(),
  };
  getDb().prepare(`
    INSERT INTO reconciliations (id, user_id, selected_document_ids, amount_tolerance, date_tolerance_days, status, result_json, created_at)
    VALUES (@id, @user_id, @selected_document_ids, @amount_tolerance, @date_tolerance_days, @status, @result_json, @created_at)
  `).run(row);
  return serialize(row);
}

export function listReconciliations(userId) {
  return getDb().prepare("SELECT * FROM reconciliations WHERE user_id = ? ORDER BY created_at DESC").all(userId).map(serialize);
}

export function getReconciliation(userId, id) {
  const row = getDb().prepare("SELECT * FROM reconciliations WHERE id = ? AND user_id = ?").get(id, userId);
  if (!row) throw new AppError(404, "RECONCILIATION_NOT_FOUND", "This reconciliation does not exist or is not available to your account.");
  return serialize(row);
}
