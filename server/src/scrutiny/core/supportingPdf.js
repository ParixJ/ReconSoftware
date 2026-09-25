import { normalizeAmount, toPaise } from "./money.js";
import { readPdfLines, readScannedPdfLines } from "./pdfText.js";
import { PDF_LABEL_ALIASES, parseDocumentDate, resolvePdfIdentity } from "./pdfEvidence.js";

const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/;
const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/i;
const MONEY = /^-?\d[\d,]*(?:\.\d{2})$/;

function provenance(sourceId, originalName, line) {
  return { sourceId, originalName, pageNumber: line.pageNumber, rowNumber: line.rowNumber };
}

function yearRange(start) {
  const year = Number(start.slice(-4));
  const month = Number(start.slice(3, 5));
  const first = month >= 4 ? year : year - 1;
  return `${first}-${first + 1}`;
}

function statementYear(text) {
  const match = /Financial\s+Year\s+(20\d{2})\s*[-–]\s*(20\d{2}|\d{2})/i.exec(text);
  if (!match) return null;
  return `${match[1]}-${match[2].length === 2 ? match[1].slice(0, 2) + match[2] : match[2]}`;
}

function base({ sourceId, originalName, completeExport, documentType, financialYear, taxpayerId,
  records, issues = [], pageCount, truncated = false, ocrUsed = false, textLines = [],
  ocrTextLines = [], unclassifiedSections = [], status = null }) {
  const parseWarnings = [];
  const aliases = PDF_LABEL_ALIASES[documentType];
  const sectionStart = aliases ? textLines.findIndex((line) => aliases.section.some((pattern) => pattern.test(line.text))) : -1;
  const identityEvidence = ocrTextLines.length ? ocrTextLines : textLines;
  const identityScope = identityEvidence.slice(0, sectionStart > 0 && !ocrTextLines.length ? sectionStart : 40);
  let identity = resolvePdfIdentity(identityScope,
    { kind: documentType?.startsWith("gst_") ? "gstin" : "pan" });
  if (!identity.taxpayerId && identityEvidence.length > identityScope.length) {
    const fallback = resolvePdfIdentity(identityEvidence,
      { kind: documentType?.startsWith("gst_") ? "gstin" : "pan", allowUnlabeled: true });
    if (fallback.taxpayerId) identity = { ...fallback, issues: [{
      code: "AUDIT_IDENTITY_FULL_TEXT_USED",
      message: "The taxpayer identity was found outside the usual identity section; review OCR/source layout.",
    }] };
  }
  issues.push(...identity.issues);
  if (aliases && !textLines.some((line) => aliases.section.some((pattern) => pattern.test(line.text)))) {
    issues.push({ code: "AUDIT_PDF_SECTION_UNMAPPED",
      message: `No ${documentType} section heading matched PDF label catalog version ${PDF_LABEL_ALIASES.version}; extraction coverage requires review.` });
  }
  if (aliases) for (const line of textLines) {
    if (line.text.length > 100 || line.cells?.length > 2 ||
        !/^(?:PART[-\s]*[IVX]+\b|INCOME\s+FROM\b|GROSS\s+TOTAL\b|TOTAL\s+INCOME\b|GST\b|INTEREST\b|ELECTRONIC\b)/i.test(line.text) ||
        !aliases.broadSection.test(line.text) ||
        aliases.section.some((pattern) => pattern.test(line.text))) continue;
    if (aliases.outOfScope?.some((pattern) => pattern.test(line.text))) {
      parseWarnings.push(`Page ${line.page}, line ${line.line} is a recognized section outside the supported scrutiny comparisons.`);
      continue;
    }
    issues.push({ code: "AUDIT_PDF_HEADING_UNMAPPED", pageNumber: line.page,
      rowNumber: line.line, message: `A possible ${documentType} heading on page ${line.page}, line ${line.line} is outside PDF label catalog version ${PDF_LABEL_ALIASES.version}.` });
  }
  if (truncated) issues.push({ code: "AUDIT_PDF_PAGE_LIMIT", message: "Only the first 50 PDF pages were read." });
  if (completeExport !== true) issues.push({ code: "AUDIT_EXPORT_COMPLETENESS_UNCONFIRMED",
    message: "Export completeness has not been confirmed." });
  return { sourceId, role: "supporting_document", originalName, format: "pdf", documentType,
    financialYear, taxpayerId: identity.taxpayerId, identityCandidates: identity.candidates,
    labelAliasVersion: PDF_LABEL_ALIASES.version,
    completeExport: completeExport === true, pageCount, ocrUsed, textLines, ocrTextLines,
    parseWarnings,
    unclassifiedSections,
    status: identity.status === "review" ? "review" : identity.status === "insufficient_data" ? "insufficient_data" :
      issues.length ? "insufficient_data" : status ?? (records.length ? "ready" : "insufficient_data"),
    recordCount: records.length, records, issues };
}

function form26as({ lines, allText, ...meta }) {
  const records = [];
  const issues = [];
  const reportedGroups = new Map();
  let party = null;
  let tan = null;
  let part = "tds";
  for (const line of lines) {
    if (PDF_LABEL_ALIASES.form_26as.section[0].test(line.text)) part = "tds";
    if (PDF_LABEL_ALIASES.form_26as.section[1].test(line.text)) part = "tcs";
    const partyTan = /\b([A-Z]{4}\d{5}[A-Z])\b/.exec(line.text);
    if (partyTan) {
      tan = partyTan[1];
      const at = line.text.indexOf(tan);
      party = line.text.slice(0, at).replace(/^\s*\d+\s*/, "").trim() || null;
      const totals = line.cells.filter((cell) => MONEY.test(cell) && cell.includes("."));
      if (totals.length === 3) reportedGroups.set(`${part}\0${tan}`, totals.map(toPaise));
    }
    const section = /\b(194[A-Z0-9]+|206[A-Z0-9]+)\b/.exec(line.text);
    const date = /\b\d{2}-[A-Za-z]{3}-20\d{2}\b/.exec(line.text);
    if (!section || !date) continue;
    const amounts = line.cells.filter((cell) => MONEY.test(cell) && cell.includes("."));
    if (amounts.length !== 3) {
      issues.push({ code: "AUDIT_26AS_ROW_UNREADABLE", rowNumber: line.rowNumber,
        message: `A Form 26AS transaction on page ${line.pageNumber} has unreadable amounts.` });
      continue;
    }
    const parsedDate = parseDocumentDate(date[0]);
    if (!parsedDate || parsedDate.financialYear !== statementYear(allText)) {
      issues.push({ code: "AUDIT_26AS_DATE_UNREADABLE", rowNumber: line.rowNumber,
        pageNumber: line.pageNumber, message: "Transaction date is impossible or conflicts with the statement financial year." });
    }
    records.push({ section: section[1], transactionDate: parsedDate?.financialYear === statementYear(allText) ? date[0] : null,
      rawDate: date[0],
      type: section[1].startsWith("206") ? "tcs" : "tds", tan, party,
      amount: normalizeAmount(amounts[0]), taxAmount: normalizeAmount(amounts[1]),
      depositedAmount: normalizeAmount(amounts[2]),
      bookingStatus: line.cells.find((cell) => cell === "F" || cell === "U") || null,
      provenance: provenance(meta.sourceId, meta.originalName, line) });
  }
  if (!records.length) issues.push({ code: "AUDIT_26AS_EMPTY", message: "No TDS/TCS transaction rows were found." });
  for (const [key, expected] of reportedGroups) {
    const [type, groupTan] = key.split("\0");
    const actual = records.filter((record) => record.type === type && record.tan === groupTan)
      .reduce((sum, record) => [sum[0] + toPaise(record.amount),
        sum[1] + toPaise(record.taxAmount), sum[2] + toPaise(record.depositedAmount)], [0n, 0n, 0n]);
    if (actual.some((amount, index) => amount !== expected[index])) issues.push({
      code: "AUDIT_26AS_GROUP_TOTAL_MISMATCH",
      message: `The ${type.toUpperCase()} transactions for ${groupTan} do not agree with the displayed Form 26AS control total.`,
    });
  }
  return base({ ...meta, documentType: "form_26as", financialYear: statementYear(allText),
    taxpayerId: PAN.exec(allText)?.[0] || null, records, issues });
}

function computation({ lines, allText, ...meta }) {
  const assessment = /Assessment\s+Year\s+(20\d{2})\s*[-–]\s*(20\d{2}|\d{2})/i.exec(allText);
  const ay = assessment ? Number(assessment[1]) : null;
  const refundLine = lines.find((line) => /\bRefundable\b/i.test(line.text));
  const amount = refundLine?.cells.filter((cell) => /^\d[\d,]*$/.test(cell)).at(-1);
  const issues = [];
  if (!ay || !amount) issues.push({ code: "AUDIT_COMPUTATION_UNREADABLE",
    message: "Assessment year or refundable amount could not be identified." });
  const records = amount && ay ? [{ kind: "prior_year_refund_reference",
    assessmentYear: `${ay}-${ay + 1}`, amount: normalizeAmount(amount),
    provenance: provenance(meta.sourceId, meta.originalName, refundLine) }] : [];
  for (const [kind, pattern] of PDF_LABEL_ALIASES.tax_computation.summaries) {
    const at = lines.findIndex((line) => pattern.test(line.cells[0] || line.text));
    if (at < 0) continue;
    const line = lines[at];
    const source = line.cells.slice(1).some((cell) => /^\d[\d,]*(?:\.\d{1,2})?$/.test(cell)) ? line : lines[at + 1];
    const value = source?.cells.findLast((cell) => /^\d[\d,]*(?:\.\d{1,2})?$/.test(cell));
    if (!value) continue;
    records.push({ kind, amount: normalizeAmount(value), assessmentYear: ay ? `${ay}-${ay + 1}` : null,
      provenance: provenance(meta.sourceId, meta.originalName, source) });
  }
  const gstHeading = lines.findIndex((line) => /^GST Turnover Detail$/i.test(line.text));
  if (gstHeading >= 0) {
    const gstLine = lines.slice(gstHeading + 1, gstHeading + 7).find((line) =>
      GSTIN.test(line.text) && line.cells.some((cell) => /^\d[\d,]*$/.test(cell)));
    const value = gstLine?.cells.findLast((cell) => /^\d[\d,]*$/.test(cell));
    if (value) records.push({ kind: "gst_turnover", gstin: GSTIN.exec(gstLine.text)?.[0] || null,
      amount: normalizeAmount(value), assessmentYear: ay ? `${ay}-${ay + 1}` : null,
      provenance: provenance(meta.sourceId, meta.originalName, gstLine) });
  }
  return base({ ...meta, documentType: "tax_computation",
    financialYear: ay ? `${ay - 1}-${ay}` : null,
    taxpayerId: PAN.exec(allText)?.[0] || null, records, issues });
}

const TIS_CATEGORIES = [
  ["interest_deposit", PDF_LABEL_ALIASES.tis.section[0]],
  ["business_receipts", PDF_LABEL_ALIASES.tis.section[1]],
  ["gst_turnover", PDF_LABEL_ALIASES.tis.section[2]],
  ["gst_purchases", PDF_LABEL_ALIASES.tis.section[3]],
  ["time_deposit_purchase", PDF_LABEL_ALIASES.tis.section[4]],
];

function tis({ lines, allText, ...meta }) {
  const records = [];
  const issues = [];
  const unclassifiedSections = [];
  const totals = new Map();
  let category = null;
  for (const line of lines) {
    const label = line.cells.slice(0, 2).join(" ");
    const identified = TIS_CATEGORIES.find(([, pattern]) => pattern.test(label));
    const amounts = line.cells.filter((cell) => /^\d[\d,]*(?:\.\d{1,2})?$/.test(cell));
    if (identified && amounts.length >= 2 && line.cells.length <= 5) {
      category = identified[0];
      const amount = normalizeAmount(amounts.at(-2));
      const acceptedAmount = normalizeAmount(amounts.at(-1));
      const prior = totals.get(category);
      if (prior && prior.amount !== amount) issues.push({ code: "AUDIT_TIS_TOTAL_CONFLICT",
        rowNumber: line.rowNumber, pageNumber: line.pageNumber,
        message: `OCR found conflicting ${category} summary amounts.` });
      if (!prior || line.pageNumber > prior.provenance.pageNumber) totals.set(category, {
        kind: "category_total", category, amount, acceptedAmount,
        confidence: "ocr_review_required", provenance: provenance(meta.sourceId, meta.originalName, line) });
      continue;
    }
    if (!identified && amounts.length >= 2 && line.cells.length <= 5 &&
        /[A-Za-z]{3}/.test(label) && !/^(?:SR\.?\s*NO|SOURCE|SYSTEM)/i.test(label.trim())) {
      category = null;
      unclassifiedSections.push({ rawCells: line.cells,
        provenance: provenance(meta.sourceId, meta.originalName, line) });
      issues.push({ code: "AUDIT_TIS_SECTION_UNMAPPED", pageNumber: line.pageNumber,
        rowNumber: line.rowNumber,
        message: `A TIS category heading did not match label catalog version ${PDF_LABEL_ALIASES.version}.` });
      continue;
    }
    if (!category || line.cells.length < 7 || !/^\d{1,2}$/.test(line.cells[0])) continue;
    const value = line.cells.at(-1);
    if (!/^\d[\d,]*(?:\.\d{1,2})?$/.test(value)) {
      issues.push({ code: "AUDIT_TIS_DETAIL_UNREADABLE", rowNumber: line.rowNumber,
        pageNumber: line.pageNumber, message: `A ${category} detail amount requires review.` });
      continue;
    }
    records.push({ kind: "detail", category, amount: normalizeAmount(value),
      section: /\b(194[A-Z0-9]+|206[A-Z0-9]+)\b/i.exec(line.text)?.[1] || null,
      reference: /\b[A-Z]{4}\d{5}[A-Z]\b/.exec(line.text)?.[0] || null,
      party: line.cells[3] || null, confidence: "ocr_review_required",
      provenance: provenance(meta.sourceId, meta.originalName, line) });
  }
  records.unshift(...totals.values());
  if (!totals.size) {
    for (const line of lines) {
      const identified = TIS_CATEGORIES.find(([, pattern]) => pattern.test(line.text));
      if (!identified) continue;
      const windowText = [line, lines.find((candidate) =>
        candidate.pageNumber === line.pageNumber && candidate.rowNumber === line.rowNumber + 1)]
        .filter(Boolean).map((item) => item.text).join(" ");
      const amounts = [...windowText.matchAll(/\b\d[\d,]*(?:\.\d{1,2})?\b/g)].map((match) => match[0])
        .filter((value) => !/^20\d{2}$/.test(value.replaceAll(",", "")));
      if (amounts.length < 2) continue;
      const summary = { kind: "category_total", category: identified[0],
        amount: normalizeAmount(amounts.at(-2)), acceptedAmount: normalizeAmount(amounts.at(-1)),
        confidence: "text_summary_review_required", provenance: provenance(meta.sourceId, meta.originalName, line) };
      totals.set(identified[0], summary);
      records.unshift(summary);
    }
  }
  if (!totals.size) issues.push({ code: "AUDIT_TIS_EMPTY", message: "No TIS category totals were readable." });
  return base({ ...meta, documentType: "tis", financialYear: statementYear(allText),
    taxpayerId: PAN.exec(allText)?.[0] || null, records, issues, unclassifiedSections,
    status: totals.size && meta.completeExport ? "review" : "insufficient_data" });
}

function gstLedger({ lines, allText, ...meta }, kind) {
  const records = [];
  const issues = [];
  const period = /Period:\s*From\s*-?\s*(\d{2}\/\d{2}\/\d{4})\s*To\s*-?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(allText);
  const periodStart = period ? parseDocumentDate(period[1]) : null;
  const periodEnd = period ? parseDocumentDate(period[2]) : null;
  const startTime = periodStart ? Date.UTC(periodStart.year, periodStart.month - 1, periodStart.day) : null;
  const endTime = periodEnd ? Date.UTC(periodEnd.year, periodEnd.month - 1, periodEnd.day) : null;
  const headings = new Map();
  const headingPatterns = PDF_LABEL_ALIASES[kind]?.section || [];
  for (const line of lines) {
    const heading = headingPatterns.map((pattern) => pattern.exec(line.text)).find(Boolean);
    if (heading?.[1]) headings.set(line.pageNumber, heading[1].toLowerCase());
  }
  for (const line of lines) {
    const side = line.cells.find((cell) => cell === "Credit" || cell === "Debit");
    const isOpening = /Opening Balance/i.test(line.text);
    const isClosing = /Closing Balance/i.test(line.text);
    if (!side && !isOpening && !isClosing) continue;
    const date = line.cells.find((cell) => /^\d{2}\/\d{2}\/20\d{2}$/.test(cell)) || null;
    if (side && !date) continue; // column headings are not transactions
    const validDate = date ? parseDocumentDate(date) : null;
    if (date && !validDate) issues.push({ code: "AUDIT_GST_LEDGER_DATE_UNREADABLE",
      pageNumber: line.pageNumber, rowNumber: line.rowNumber,
      message: "GST ledger row contains an impossible calendar date." });
    const dateTime = validDate ? Date.UTC(validDate.year, validDate.month - 1, validDate.day) : null;
    const dateOutOfPeriod = dateTime !== null && startTime !== null && endTime !== null &&
      (dateTime < startTime || dateTime > endTime);
    if (dateOutOfPeriod) {
      issues.push({ code: "AUDIT_GST_LEDGER_DATE_OUT_OF_PERIOD", pageNumber: line.pageNumber,
        rowNumber: line.rowNumber, message: "GST ledger row date conflicts with the printed coverage period." });
    }
    const detailAt = line.cells.findIndex((cell) => cell === side || /(?:Opening|Closing) Balance/i.test(cell));
    const amounts = line.cells.slice(detailAt + 1).filter((cell) => /^-?\d+(?:\.\d{1,2})?$/.test(cell));
    const width = kind === "gst_credit_ledger" ? 5 : 6;
    const expected = side ? width * 2 : width;
    if (amounts.length !== expected) {
      issues.push({ code: "AUDIT_GST_LEDGER_ROW_UNREADABLE", rowNumber: line.rowNumber,
        message: `A GST ledger row on page ${line.pageNumber} has ${amounts.length} amounts instead of ${expected}.` });
      continue;
    }
    const total = side ? amounts[width - 1] : null;
    const balance = amounts.at(-1);
    const taxHeads = kind === "gst_credit_ledger" && side ? {
      integrated: normalizeAmount(amounts[0]), central: normalizeAmount(amounts[1]),
      state: normalizeAmount(amounts[2]), cess: normalizeAmount(amounts[3]),
    } : null;
    const taxPeriod = line.cells.find((cell) => /^[A-Za-z]{3}-\d{2}$/.test(cell)) || null;
    records.push({ kind: isOpening ? "opening" : isClosing ? "closing" : "transaction",
      account: kind === "gst_credit_ledger" ? "all_tax_heads" : headings.get(line.pageNumber) || null,
      side: side?.toLowerCase() || null, date: validDate && !dateOutOfPeriod ? date : null,
      rawDate: date, taxPeriod,
      reference: line.cells.find((cell) => /^(?:AB|DI|DC|R\d|20\d{6})[A-Z0-9]{6,}$/.test(cell)) || null,
      amount: total === null ? null : normalizeAmount(total), balance: normalizeAmount(balance),
      ...(taxHeads ? { taxHeads } : {}),
      provenance: provenance(meta.sourceId, meta.originalName, line) });
  }
  if (!periodStart || !periodEnd || startTime > endTime) issues.push({ code: "AUDIT_GST_LEDGER_PERIOD_UNREADABLE",
    message: "The GST ledger period could not be read." });
  if (!records.length) issues.push({ code: "AUDIT_GST_LEDGER_EMPTY",
    message: "No GST ledger balance or transaction rows were found." });
  return base({ ...meta, documentType: kind, financialYear: periodStart && periodEnd ? yearRange(period[1]) : null,
    taxpayerId: GSTIN.exec(allText)?.[0] || null, records, issues });
}

export async function parseSupportingPdf({ filePath, sourceId, originalName, completeExport }) {
  let pdf = await readPdfLines(filePath);
  if (pdf.lines.map((line) => line.text).join(" ").trim().length < 100) {
    pdf = await readScannedPdfLines(filePath);
  }
  const allText = pdf.fullText || pdf.lines.map((line) => line.text).join("\n");
  const textLines = pdf.lines.map((line) => ({ page: line.pageNumber, line: line.rowNumber,
    text: line.text, cells: line.cells, confidence: line.confidence ?? null,
    provenance: provenance(sourceId, originalName, line) }));
  const ocrTextLines = pdf.ocrTextLines?.map((line) => ({ ...line,
    provenance: provenance(sourceId, originalName, line) })) || [];
  const context = { ...pdf, allText, sourceId, originalName, completeExport, textLines, ocrTextLines };
  if (PDF_LABEL_ALIASES.form_26as.document.some((pattern) => pattern.test(allText))) return form26as(context);
  if (PDF_LABEL_ALIASES.tax_computation.document.some((pattern) => pattern.test(allText))) return computation(context);
  if (PDF_LABEL_ALIASES.tis.document.some((pattern) => pattern.test(allText))) return tis(context);
  if (PDF_LABEL_ALIASES.gst_cash_ledger.document.some((pattern) => pattern.test(allText))) return gstLedger(context, "gst_cash_ledger");
  if (PDF_LABEL_ALIASES.gst_credit_ledger.document.some((pattern) => pattern.test(allText))) return gstLedger(context, "gst_credit_ledger");
  return base({ ...context, documentType: null, financialYear: null, taxpayerId: null,
    records: [], issues: [{ code: "AUDIT_SUPPORT_DOCUMENT_UNKNOWN",
      message: "This PDF does not match a supported Form 26AS, computation, or GST ledger layout." }] });
}
