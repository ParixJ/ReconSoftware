import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { AppError } from "../../errors.js";
import { ERROR_CODES } from "../../api/errorCodes.js";
import { normalizeAmount } from "./money.js";
import { readPdfLines } from "./pdfText.js";
import { readAisGrid } from "./aisGrid.js";
import { consumeAisGridPage, createAisTableState, finishAisTables } from "./aisTables.js";
import { resolvePdfIdentity } from "./pdfEvidence.js";

const require = createRequire(import.meta.url);
const languagePath = path.join(path.dirname(require.resolve("@tesseract.js-data/eng")), "4.0.0");
const MAX_OCR_PAGES = 10;
let ocrActive = false;

function fiscalYear(text) {
  const match = /Financial\s+Year\s*[:\-]?\s*(20\d{2})\s*[-–]\s*(20\d{2}|\d{2})/i.exec(text);
  if (!match) return null;
  const end = match[2].length === 2 ? `${match[1].slice(0, 2)}${match[2]}` : match[2];
  return `${match[1]}-${end}`;
}

async function ocrImagePages(buffer, { sourceId, originalName, financialYear }) {
  if (ocrActive) throw new AppError(429, ERROR_CODES.AUDIT_OCR_BUSY,
    "Another AIS PDF is being OCR-processed. Retry this upload shortly.");
  ocrActive = true;
  let worker;
  let loadingTask;
  try {
    const [{ getDocument }, { createWorker }] = await Promise.all([
      import("pdfjs-dist/legacy/build/pdf.mjs"), import("tesseract.js"),
    ]);
    loadingTask = getDocument({ data: new Uint8Array(buffer) });
    const document = await loadingTask.promise;
    worker = await createWorker("eng", 1, { langPath: languagePath, cacheMethod: "none" });
    const pages = [];
    let tableState;
    for (let number = 1; number <= Math.min(document.numPages, MAX_OCR_PAGES); number += 1) {
      const page = await document.getPage(number);
      const overview = await readAisGrid(page, worker, number, { requestedScale: 2 });
      const grid = await readAisGrid(page, worker, number);
      for (const row of grid.rows) {
        const mid = (row.top + row.bottom) / (2 * grid.height);
        const alternate = overview.rows.find((candidate) => candidate.cells.length === row.cells.length &&
          Math.abs((candidate.top + candidate.bottom) / (2 * overview.height) - mid) < 0.003);
        if (alternate) row.alternateCells = alternate.cells;
      }
      if (!tableState) tableState = createAisTableState({ sourceId, originalName,
        taxpayerId: null,
        financialYear: fiscalYear(grid.text) || fiscalYear(overview.text) || financialYear });
      await consumeAisGridPage(tableState, grid);
      pages.push({ pageNumber: number, text: grid.text, confidence: grid.confidence });
      page.cleanup();
    }
    return { pages, pageCount: document.numPages, tableData: finishAisTables(tableState) };
  } finally {
    await worker?.terminate();
    await loadingTask?.destroy();
    ocrActive = false;
  }
}

async function tableDataFromTextLines(lines, { sourceId, originalName, financialYear }) {
  const tableState = createAisTableState({ sourceId, originalName, taxpayerId: null, financialYear });
  const pageNumbers = [...new Set(lines.map((line) => line.pageNumber))].sort((a, b) => a - b);
  for (const pageNumber of pageNumbers) {
    const rows = lines.filter((line) => line.pageNumber === pageNumber)
      .flatMap((line) => {
        const text = line.text.replace(/\s+/g, " ").trim();
        if (/^(?:Code\s+Source|ucted\s+Deposited)$/i.test(text)) return [];
        const cells = /^Sr\.?\s*No\.?\s+Information\b/i.test(text) ?
          ["Sr. No.", "Information Code", "Information Description", "Information Source", "Count", "Amount"] :
          /^SR\.?\s*NO\.?\s+Quarter\s+Transaction\s+Date\b/i.test(text) ?
            ["SR. NO.", "Quarter", "Transaction Date", "Amount Paid", "Tax Deducted", "Tax Deposited", "Status"] :
            line.cells;
        return [{
          pageNumber,
          rowNumber: line.rowNumber,
          cells,
        top: line.top ?? line.rowNumber * 10,
        bottom: line.bottom ?? line.rowNumber * 10 + 8,
          bounds: line.bounds?.length === cells.length + 1 ? line.bounds :
            Array.from({ length: cells.length + 1 }, (_, index) => index * 100),
        }];
      });
    await consumeAisGridPage(tableState, { pageNumber, rows,
      refineCell: async (row, column) => ({ text: row.cells[column] || "", confidence: 100 }) });
  }
  return finishAisTables(tableState);
}

export async function parseAisPdf({ filePath, sourceId, originalName, completeExport, financialYear }) {
  let pages;
  let pageCount;
  let ocrUsed = false;
  let textTruncated = false;
  let tableData = null;
  const extracted = await readPdfLines(filePath);
  if (extracted.lines.map((line) => line.text).join(" ").trim().length >= 100) {
    pageCount = extracted.pageCount;
    textTruncated = extracted.truncated;
    tableData = await tableDataFromTextLines(extracted.lines, { sourceId, originalName,
      financialYear: fiscalYear(extracted.lines.map((line) => line.text).join("\n")) || financialYear });
    const extractedPageCount = Math.max(0, ...extracted.lines.map((line) => line.pageNumber));
    pages = Array.from({ length: extractedPageCount }, (_, index) => ({ pageNumber: index + 1,
      text: extracted.lines.filter((line) => line.pageNumber === index + 1).map((line) => line.text).join("\n"),
      confidence: null }));
  } else {
    ({ pages, pageCount, tableData } = await ocrImagePages(await fs.readFile(filePath), {
      sourceId, originalName, financialYear,
    }));
    ocrUsed = true;
  }
  const fullText = pages.map((page) => page.text).join("\n");
  const detected = /Annual\s+Information\s+Statement(?:\s*\(AIS\))?/i.test(fullText);
  const textLines = pages.flatMap((page) => page.text.split(/\r?\n/)
    .map((line) => line.trim()).filter(Boolean).map((line, index) => ({
      page: page.pageNumber, line: index + 1, text: line, confidence: page.confidence,
      provenance: { sourceId, originalName, pageNumber: page.pageNumber, rowNumber: index + 1 },
    })));
  const hasStructuredTables = Boolean(tableData?.tables?.length);
  const records = tableData?.records || [];
  const printedYear = fiscalYear(fullText);
  const year = printedYear || financialYear || null;
  const identityStart = textLines.findIndex((line) => /Part\s+A\s*[-–]\s*General\s+Information/i.test(line.text));
  const identityEnd = textLines.findIndex((line, index) => index > identityStart &&
    /Part\s+B\d?\s*[-–]|Information\s+relating\s+to\s+tax/i.test(line.text));
  const identityLines = textLines.slice(identityStart < 0 ? 0 : identityStart,
    identityEnd < 0 ? Math.min(textLines.length, 35) : identityEnd);
  let identity = resolvePdfIdentity(identityLines);
  if (!identity.taxpayerId && textLines.length > identityLines.length) {
    const fallback = resolvePdfIdentity(textLines, { allowUnlabeled: true });
    if (fallback.taxpayerId) identity = { ...fallback, issues: [{
      code: "AUDIT_IDENTITY_FULL_TEXT_USED",
      message: "The AIS taxpayer identity was found outside the usual identity section; review OCR/source layout.",
    }] };
  }
  const taxpayer = identity.taxpayerId;
  for (const record of records) record.taxpayerId = taxpayer;
  for (const line of hasStructuredTables ? [] : textLines) {
    const section = /\b(?:TDS\s*[-–]?\s*(194A|194Q)|TCS\s*[-–]?\s*(206CE))\b/i.exec(line.text);
    if (!section) continue;
    const rawAmount = /(\d[\d,]*(?:\.\d{1,2})?)\s*$/.exec(line.text)?.[1];
    if (!rawAmount || !/[A-Za-z]/.test(line.text.slice(section.index + section[0].length))) continue;
    const code = section[1] || section[2];
    const category = code === "194A" ? "INTEREST" : code === "194Q" ? "BUSINESS_RECEIPTS" : "TCS_206CE";
    const party = /\|\s*([A-Z][A-Z\s.&-]{3,80})\s*\([A-Z0-9]+\)/.exec(line.text)?.[1].trim() || null;
    records.push({ category, section: code, taxpayerId: taxpayer, period: year,
      reference: /\b[A-Z]{4}\d{5}[A-Z]\b/.exec(line.text)?.[0] || null, party,
      amount: normalizeAmount(rawAmount), rawAmount, confidence: ocrUsed ? "ocr_unverified" : "text_summary",
      provenance: line.provenance });
  }
  const refundLine = textLines.find((line) => /\b20\d{2}[\s-]*2\d\b.*(?:direct credit|ECS)/i.test(line.text));
  if (refundLine) records.push({ category: "REFUND", taxpayerId: taxpayer,
    period: year, rawText: refundLine.text, amount: null, confidence: "ocr_unverified",
    provenance: refundLine.provenance });
  const issues = [...identity.issues];
  if (!detected) issues.push({ code: "AIS_PDF_NOT_DETECTED",
    message: "The PDF text does not identify an Annual Information Statement." });
  if (printedYear && financialYear && printedYear !== financialYear) issues.push({
    code: "AUDIT_PERIOD_CONFLICT",
    message: `AIS printed financial year ${printedYear} conflicts with the requested ${financialYear}.`,
  });
  if (pageCount > MAX_OCR_PAGES && ocrUsed) issues.push({ code: "AIS_OCR_PAGE_LIMIT",
    message: `Only the first ${MAX_OCR_PAGES} of ${pageCount} pages were OCR-processed.` });
  if (textTruncated) issues.push({ code: "AIS_TEXT_PAGE_LIMIT",
    message: `Only the first ${pages.length} of ${pageCount} text pages were extracted.` });
  issues.push(...(tableData?.issues || []));
  if (!hasStructuredTables) issues.push({ code: "AIS_TRANSACTION_MAPPING_UNVERIFIED",
    message: "AIS summary candidates were extracted, but transaction tables were not mapped." });
  if (completeExport !== true) issues.push({ code: "AUDIT_EXPORT_COMPLETENESS_UNCONFIRMED",
    message: "Export completeness has not been confirmed." });
  const roundingWarnings = tableData?.warnings || [];
  return { sourceId, role: "ais", originalName, format: "pdf", documentType: detected ? "ais" : null,
    ocrUsed, pageCount, financialYear: year,
    taxpayerId: taxpayer, identityCandidates: identity.candidates, completeExport: completeExport === true,
    status: identity.status === "review" ? "review" :
      detected && taxpayer && hasStructuredTables && !issues.length ? "ready" : "insufficient_data",
    recordCount: records.length, records, tables: tableData?.tables || [],
    unclassifiedSections: tableData?.unclassifiedSections || [], rejectedRows: tableData?.rejectedRows || [],
    textLines, issues,
    parseWarnings: [
      ...(ocrUsed ? ["Local OCR was used because the PDF has no text layer; verify the recognized text against the original."] : []),
      ...(roundingWarnings.length ? [
        `${roundingWarnings.length} AIS table(s) have a displayed-row versus printed-total difference of at most one rupee; review their verified_with_rounding status to distinguish source rounding from OCR.`,
      ] : []),
    ] };
}
