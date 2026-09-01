import crypto from "node:crypto";
import { getDb } from "../db/database.js";
import { AppError } from "../errors.js";
import { rootFieldForAnomaly } from "../parsers/anomalies.js";
import { addMoney, asNumber, emptyMoney, jsonSafeParse } from "../parsers/utils.js";
import { rowsForReconciliation } from "./documentService.js";

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

const MAIN_RETURN_TYPES = new Set(["gstr1", "gstr3b"]);

function crossExaminationDocument(document) {
  return {
    id: document.id,
    originalName: document.originalName,
    documentType: document.documentType,
  };
}

export function crossExamineClientGstins(documents) {
  const groups = new Map();
  const missingDocuments = [];
  for (const document of documents) {
    const gstin = String(document.gstin || "").trim().toUpperCase();
    if (!gstin) {
      missingDocuments.push(crossExaminationDocument(document));
      continue;
    }
    if (!groups.has(gstin)) groups.set(gstin, []);
    groups.get(gstin).push(crossExaminationDocument(document));
  }
  const gstinGroups = [...groups.entries()].map(([gstin, groupedDocuments]) => ({ gstin, documents: groupedDocuments }));
  const status = gstinGroups.length > 1
    ? "mismatch"
    : gstinGroups.length === 0
      ? "unverified"
      : missingDocuments.length
        ? "partial"
        : "matched";
  return {
    status,
    canReconcile: status !== "mismatch",
    clientGstin: gstinGroups.length === 1 ? gstinGroups[0].gstin : null,
    documentCount: documents.length,
    identifiedCount: documents.length - missingDocuments.length,
    gstinGroups,
    missingDocuments,
  };
}

function validPeriod(value) {
  return /^(0[1-9]|1[0-2])\d{4}$/.test(value || "");
}

function periodSortKey(value) {
  return validPeriod(value) ? `${value.slice(2)}${value.slice(0, 2)}` : "999999";
}

function exceptionId(exception) {
  const parts = [
    exception.documentId || "selection",
    exception.returnPeriod || "unassigned",
    exception.rootField || rootFieldForAnomaly(exception.code),
    exception.code || "UNKNOWN_EXCEPTION",
    Number.isInteger(exception.rowIndex) ? `row-${exception.rowIndex}` : "root",
  ];
  return `exception:${parts.map((part) => String(part).replace(/[^A-Za-z0-9_.-]+/g, "-")).join(":")}`;
}

function identifyExceptions(exceptions, returnPeriod) {
  const identified = exceptions.map((exception) => {
    const rootField = exception.rootField || rootFieldForAnomaly(exception.code);
    const item = { ...exception, returnPeriod: exception.returnPeriod ?? returnPeriod, rootField };
    return { ...item, id: exceptionId(item) };
  });
  return [...new Map(identified.map((exception) => [exception.id, exception])).values()];
}

function aggregateSummary(documents, category) {
  const total = emptyMoney();
  for (const document of documents) addMoney(total, document.parsed.summary?.[category] || {});
  return total;
}

function salesRegisterSummaryForPeriod(documents, returnPeriod) {
  const total = emptyMoney();
  const includedDocumentIds = [];
  for (const document of documents) {
    const periodSummary = document.parsed.periods?.[returnPeriod]?.net;
    const singlePeriodSummary = !document.parsed.periods && document.returnPeriod === returnPeriod
      ? document.parsed.summary?.taxableOutward
      : null;
    const summary = periodSummary || singlePeriodSummary;
    if (!summary) continue;
    addMoney(total, summary);
    includedDocumentIds.push(document.id);
  }
  return { total, includedDocumentIds };
}

function comparison({ returnPeriod, table, label, measure, left, right, tolerance, kind = "liability", sourceLabel = "GSTR-1", filedLabel = "GSTR-3B" }) {
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
  } else if (!matched && kind.startsWith("books") && difference > 0) {
    risk = "high";
    suggestion = `The sales register is higher than ${filedLabel}. Review invoices, debit notes, and timing items missing from the filed return.`;
  } else if (!matched && kind.startsWith("books")) {
    risk = "medium";
    suggestion = `${filedLabel} is higher than the sales register. Review amendments, credit notes, mapping, and entries posted outside the selected books extract.`;
  }
  return {
    id: `${returnPeriod || "unassigned"}-${kind}-${table}-${measure}`,
    returnPeriod,
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
    sourceLabel,
    filedLabel,
  };
}

function identityExceptions(documents) {
  const exceptions = [];
  const gstins = [...new Set(documents.map((document) => document.gstin).filter(Boolean))];
  const periods = [...new Set(documents.map((document) => document.returnPeriod).filter(Boolean))];
  if (gstins.length > 1) exceptions.push({ code: "GSTIN_MISMATCH", severity: "error", message: `Selected documents contain different client GSTINs: ${gstins.join(", ")}.`, suggestion: "Remove the unrelated file or correct its client GSTIN in Modify mapping." });
  if (periods.length > 1) exceptions.push({ code: "PERIOD_MISMATCH", severity: "error", message: `Selected documents contain different periods: ${periods.join(", ")}.`, suggestion: "Correct the affected return period in Modify mapping." });
  for (const document of documents) {
    for (const item of document.anomalies || []) exceptions.push({ ...item, documentId: document.id, documentName: document.originalName });
  }
  return exceptions;
}

function salesRegisterPeriodExceptions(documents, returnPeriod, includedDocumentIds) {
  if (!documents.length) return [];
  const included = new Set(includedDocumentIds);
  return documents.filter((document) => !included.has(document.id)).map((document) => ({
    code: "BOOKS_PERIOD_NOT_FOUND",
    severity: "error",
    rootField: `periods.${returnPeriod}`,
    documentId: document.id,
    documentName: document.originalName,
    message: `${document.originalName} has no sales-register entries for ${returnPeriod}.`,
    suggestion: "Upload a register containing this return period or remove this file from the reconciliation.",
  }));
}

function returnCardinalityExceptions(gstr1, gstr3b, gstr2b, returnPeriod) {
  const exceptions = [];
  if (!gstr1.length) exceptions.push({ code: "GSTR1_PERIOD_NOT_FOUND", severity: "error", rootField: "returnPeriod", message: `No GSTR-1 was selected for ${returnPeriod}.`, suggestion: "Select the GSTR-1 for this month or correct its return period mapping." });
  if (!gstr3b.length) exceptions.push({ code: "GSTR3B_PERIOD_NOT_FOUND", severity: "error", rootField: "returnPeriod", message: `No GSTR-3B was selected for ${returnPeriod}.`, suggestion: "Select the GSTR-3B for this month or correct its return period mapping." });
  if (gstr1.length > 1) exceptions.push({ code: "MULTIPLE_GSTR1_FOR_PERIOD", severity: "error", rootField: "returnPeriod", message: `${gstr1.length} GSTR-1 files were selected for ${returnPeriod}.`, suggestion: "Keep one GSTR-1 for this GSTIN and month; duplicate monthly returns are not summed." });
  if (gstr3b.length > 1) exceptions.push({ code: "MULTIPLE_GSTR3B_FOR_PERIOD", severity: "error", rootField: "returnPeriod", message: `${gstr3b.length} GSTR-3B files were selected for ${returnPeriod}.`, suggestion: "Keep one GSTR-3B for this GSTIN and month; duplicate monthly returns are not summed." });
  if (gstr2b.length > 1) exceptions.push({ code: "MULTIPLE_GSTR2B_FOR_PERIOD", severity: "error", rootField: "returnPeriod", message: `${gstr2b.length} GSTR-2/2B files were selected for ${returnPeriod}.`, suggestion: "Keep one GSTR-2/2B for this GSTIN and month; duplicate monthly returns are not summed." });
  return exceptions;
}

function parseInvoiceDate(value) {
  const parts = String(value || "").match(/^(\d{2})-(\d{2})-(\d{4})$/);
  return parts ? new Date(Date.UTC(Number(parts[3]), Number(parts[2]) - 1, Number(parts[1]))) : null;
}

function periodBounds(period, toleranceDays) {
  if (!validPeriod(period)) return null;
  const month = Number(period.slice(0, 2)) - 1;
  const year = Number(period.slice(2));
  const delta = toleranceDays * 86400000;
  return { start: new Date(Date.UTC(year, month, 1) - delta), end: new Date(Date.UTC(year, month + 1, 0) + delta) };
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

function documentSummary(documents) {
  return documents.map((item) => ({
    id: item.id,
    originalName: item.originalName,
    documentType: item.documentType,
    gstin: item.gstin,
    returnPeriod: item.returnPeriod,
    recordCount: item.recordCount,
  }));
}

function resultSummary(comparisons, exceptions) {
  const mismatches = comparisons.filter((item) => item.status === "mismatch");
  return {
    totalChecks: comparisons.length,
    matched: comparisons.length - mismatches.length,
    mismatched: mismatches.length,
    exceptions: exceptions.length,
    highRisk: mismatches.filter((item) => item.risk === "high").length + exceptions.filter((item) => item.severity === "error").length,
    totalAbsoluteDifference: mismatches.reduce((sum, item) => sum + Math.abs(item.difference), 0),
  };
}

function suggestionsFor(comparisons, exceptions) {
  return [...new Set([
    ...comparisons.filter((item) => item.status === "mismatch").map((item) => item.suggestion).filter(Boolean),
    ...exceptions.map((item) => item.suggestion).filter(Boolean),
  ])];
}

function addBooksComparisons(comparisons, returnPeriod, booksTotal, filedDocument, filedLabel, amountTolerance) {
  const filed = aggregateSummary([filedDocument], "taxableOutward");
  for (const measure of ["taxableValue", "igst", "cgst", "sgst", "cess"]) comparisons.push(comparison({
    returnPeriod,
    table: `Books to ${filedLabel}`,
    label: "Taxable outward supplies",
    measure,
    left: booksTotal[measure],
    right: filed[measure],
    tolerance: amountTolerance,
    kind: filedLabel === "GSTR-1" ? "books-gstr1" : "books-gstr3b",
    sourceLabel: "Sales register",
    filedLabel,
  }));
}

function buildPeriodResult(documents, returnPeriod, amountTolerance, dateToleranceDays, crossExamination) {
  const gstr1 = documents.filter((item) => item.documentType === "gstr1" && item.returnPeriod === returnPeriod);
  const gstr3b = documents.filter((item) => item.documentType === "gstr3b" && item.returnPeriod === returnPeriod);
  const gstr2b = documents.filter((item) => ["gstr2", "gstr2b"].includes(item.documentType) && item.returnPeriod === returnPeriod);
  const salesRegisters = documents.filter((item) => item.documentType === "salesRegister");
  const booksForPeriod = salesRegisterSummaryForPeriod(salesRegisters, returnPeriod);
  const includedBooks = salesRegisters.filter((document) => booksForPeriod.includedDocumentIds.includes(document.id));
  const periodDocuments = [...gstr1, ...gstr3b, ...gstr2b, ...includedBooks];
  const exceptions = identifyExceptions([
    ...(crossExamination.status === "mismatch" ? [{
      code: "GSTIN_MISMATCH",
      severity: "error",
      rootField: "gstin",
      message: `Selected documents contain different client GSTINs: ${crossExamination.gstinGroups.map((group) => group.gstin).join(", ")}.`,
      suggestion: "Remove unrelated files or correct their client GSTIN mappings before reconciling this period.",
    }] : []),
    ...identityExceptions(periodDocuments),
    ...returnCardinalityExceptions(gstr1, gstr3b, gstr2b, returnPeriod),
    ...salesRegisterPeriodExceptions(salesRegisters, returnPeriod, booksForPeriod.includedDocumentIds),
    ...dateExceptions(gstr1, dateToleranceDays),
  ], returnPeriod);
  const comparisons = [];
  const gstinConflict = crossExamination.status === "mismatch"
    || new Set(periodDocuments.map((document) => document.gstin).filter(Boolean)).size > 1;
  const usableBooks = booksForPeriod.includedDocumentIds.length > 0
    && includedBooks.every((document) => Boolean(document.gstin))
    && !gstinConflict;
  const usableGstr1 = gstr1.length === 1 && Boolean(gstr1[0].gstin) && !gstinConflict;
  const usableGstr3b = gstr3b.length === 1 && Boolean(gstr3b[0].gstin) && !gstinConflict;

  if (usableBooks && usableGstr1) {
    addBooksComparisons(comparisons, returnPeriod, booksForPeriod.total, gstr1[0], "GSTR-1", amountTolerance);
  }
  if (usableBooks && usableGstr3b) {
    addBooksComparisons(comparisons, returnPeriod, booksForPeriod.total, gstr3b[0], "GSTR-3B", amountTolerance);
  }
  if (usableGstr1 && usableGstr3b) {
    for (const definition of LIABILITY_DEFINITIONS) {
      const source = aggregateSummary(gstr1, definition.category);
      const filed = aggregateSummary(gstr3b, definition.category);
      for (const measure of definition.measures) comparisons.push(comparison({
        returnPeriod,
        table: definition.table,
        label: definition.label,
        measure,
        left: source[measure],
        right: filed[measure],
        tolerance: amountTolerance,
      }));
    }
  }
  if (gstr2b.length === 1 && Boolean(gstr2b[0].gstin) && usableGstr3b) {
    const reverseChargeSource = aggregateSummary(gstr2b, "reverseCharge");
    const reverseChargeFiled = aggregateSummary(gstr3b, "reverseCharge");
    for (const measure of ["taxableValue", "igst", "cgst", "sgst", "cess"]) comparisons.push(comparison({
      returnPeriod,
      table: "3.1(d)", label: "Inward supplies liable to reverse charge", measure,
      left: reverseChargeSource[measure], right: reverseChargeFiled[measure], tolerance: amountTolerance,
      sourceLabel: "GSTR-2/2B", filedLabel: "GSTR-3B",
    }));
    const available = aggregateSummary(gstr2b, "itcAvailable");
    addMoney(available, reverseChargeSource);
    const claimed = aggregateSummary(gstr3b, "itcClaimed");
    for (const measure of ["igst", "cgst", "sgst", "cess"]) comparisons.push(comparison({
      returnPeriod,
      table: "4(A)", label: "Input tax credit", measure,
      left: available[measure], right: claimed[measure], tolerance: amountTolerance, kind: "itc",
      sourceLabel: "GSTR-2/2B", filedLabel: "GSTR-3B",
    }));
  }

  const summary = resultSummary(comparisons, exceptions);
  return {
    returnPeriod,
    clientGstin: periodDocuments.map((item) => item.gstin).find(Boolean) || null,
    status: summary.mismatched || summary.exceptions ? "needs_review" : "matched",
    documents: documentSummary(periodDocuments),
    summary,
    comparisons,
    exceptions,
    suggestions: suggestionsFor(comparisons, exceptions),
  };
}

function buildUnassignedResult(documents) {
  const exceptions = identifyExceptions(identityExceptions(documents), null);
  const summary = resultSummary([], exceptions);
  return {
    returnPeriod: null,
    clientGstin: documents.map((item) => item.gstin).find(Boolean) || null,
    status: "needs_review",
    documents: documentSummary(documents),
    summary,
    comparisons: [],
    exceptions,
    suggestions: suggestionsFor([], exceptions),
  };
}

function buildReconciliationResult(documents, amountTolerance, dateToleranceDays) {
  const crossExamination = crossExamineClientGstins(documents);
  const returnPeriods = [...new Set(documents
    .filter((document) => MAIN_RETURN_TYPES.has(document.documentType) && validPeriod(document.returnPeriod))
    .map((document) => document.returnPeriod))]
    .sort((left, right) => periodSortKey(left).localeCompare(periodSortKey(right)));
  const periods = returnPeriods.map((returnPeriod) => buildPeriodResult(documents, returnPeriod, amountTolerance, dateToleranceDays, crossExamination));
  const unassignedDocuments = documents.filter((document) => (
    document.documentType === "unknown"
    || (MAIN_RETURN_TYPES.has(document.documentType) && !validPeriod(document.returnPeriod))
  ));
  if (unassignedDocuments.length) periods.push(buildUnassignedResult(unassignedDocuments));

  const comparisons = periods.flatMap((item) => item.comparisons);
  const exceptions = periods.flatMap((item) => item.exceptions);
  const summary = resultSummary(comparisons, exceptions);
  const knownPeriods = periods.map((item) => item.returnPeriod).filter(Boolean);
  return {
    clientGstin: crossExamination.clientGstin,
    returnPeriod: knownPeriods.length === 1 ? knownPeriods[0] : null,
    crossExamination,
    periods,
    documents: documentSummary(documents),
    summary,
    comparisons,
    exceptions,
    suggestions: suggestionsFor(comparisons, exceptions),
    methodology: `${documents.some((item) => item.documentType === "salesRegister") ? "Monthly sales-register totals mapped independently to GSTR-1 and GSTR-3B; " : ""}each return period reconciled independently for GSTR-1 liability, GSTR-3B liability and optional GSTR-2B ITC.`,
  };
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

async function serializeCurrent(userId, row, documentsPromise) {
  const reconciliation = serialize(row);
  try {
    const documents = await (documentsPromise || rowsForReconciliation(userId, reconciliation.documentIds));
    const result = buildReconciliationResult(documents, reconciliation.amountTolerance, reconciliation.dateToleranceDays);
    return { ...reconciliation, status: result.summary.mismatched || result.summary.exceptions ? "needs_review" : "matched", result };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return {
      ...reconciliation,
      result: {
        ...reconciliation.result,
        exceptions: identifyExceptions(reconciliation.result?.exceptions || [], reconciliation.result?.returnPeriod || null),
      },
    };
  }
}

export async function runReconciliation(userId, input) {
  const documentIds = [...new Set(Array.isArray(input.documentIds) ? input.documentIds.map(String) : [])];
  if (documentIds.length < 2 || documentIds.length > 10) throw new AppError(400, "INVALID_SELECTION", "Select between 2 and 10 documents to reconcile.");
  const amountTolerance = Number(input.amountTolerance ?? 1);
  const dateToleranceDays = Number(input.dateToleranceDays ?? 0);
  if (!Number.isFinite(amountTolerance) || amountTolerance < 0 || amountTolerance > 1000000) throw new AppError(400, "INVALID_AMOUNT_TOLERANCE", "Amount tolerance must be between ₹0 and ₹10,00,000.");
  if (!Number.isInteger(dateToleranceDays) || dateToleranceDays < 0 || dateToleranceDays > 90) throw new AppError(400, "INVALID_DATE_TOLERANCE", "Date tolerance must be a whole number from 0 to 90 days.");

  const documents = await rowsForReconciliation(userId, documentIds);
  if (!documents.some((item) => item.documentType === "gstr1") || !documents.some((item) => item.documentType === "gstr3b")) {
    throw new AppError(422, "REQUIRED_RETURNS_MISSING", "Select at least one GSTR-1 and one GSTR-3B document. Sales registers and GSTR-2B are optional additional checks.");
  }

  const crossExamination = crossExamineClientGstins(documents);
  if (!crossExamination.canReconcile) {
    const gstins = crossExamination.gstinGroups.map((group) => group.gstin).join(", ");
    throw new AppError(
      422,
      "CLIENT_GSTIN_MISMATCH",
      `Selected documents belong to different client GSTINs: ${gstins}. Remove the unrelated files or correct their client GSTIN mappings.`,
      { crossExamination },
    );
  }

  const result = buildReconciliationResult(documents, amountTolerance, dateToleranceDays);
  const status = result.summary.mismatched || result.summary.exceptions ? "needs_review" : "matched";
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

export async function listReconciliations(userId) {
  const rows = getDb().prepare("SELECT * FROM reconciliations WHERE user_id = ? ORDER BY created_at DESC").all(userId);
  const documentCache = new Map();
  return Promise.all(rows.map((row) => {
    const documentIds = jsonSafeParse(row.selected_document_ids, []);
    const cacheKey = [...documentIds].sort().join(":");
    if (!documentCache.has(cacheKey)) documentCache.set(cacheKey, rowsForReconciliation(userId, documentIds));
    return serializeCurrent(userId, row, documentCache.get(cacheKey));
  }));
}

export async function getReconciliation(userId, id) {
  const row = getDb().prepare("SELECT * FROM reconciliations WHERE id = ? AND user_id = ?").get(id, userId);
  if (!row) throw new AppError(404, "RECONCILIATION_NOT_FOUND", "This reconciliation does not exist or is not available to your account.");
  return serializeCurrent(userId, row);
}
