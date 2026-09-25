import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import PDFDocument from "pdfkit";
import { parseAisPdf } from "../src/scrutiny/core/aisPdf.js";
import { classifyAisSection, consumeAisGridPage, createAisTableState, finishAisTables } from "../src/scrutiny/core/aisTables.js";
import { parseDocumentDate, parseDocumentPeriod, parsePrintedAmount, quarterMatchesDate,
  resolvePdfIdentity } from "../src/scrutiny/core/pdfEvidence.js";

const gridRow = (cells, rowNumber) => ({ cells, pageNumber: 1, rowNumber,
  top: rowNumber * 30, bottom: rowNumber * 30 + 25,
  bounds: Array.from({ length: cells.length + 1 }, (_, index) => index * 100) });

async function writePdf(filePath, render) {
  const doc = new PDFDocument({ size: "A4", margin: 48 });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    doc.once("end", resolve);
    doc.once("error", reject);
  });
  render(doc);
  doc.end();
  await finished;
  await fs.writeFile(filePath, Buffer.concat(chunks));
}

test("identity requires a consistent format-valid value from labeled identity evidence", () => {
  const lines = [
    { text: "PAN ABCDE1234F", pageNumber: 1, rowNumber: 2 },
    { text: "GSTIN 24ABCDE1234F1Z0", pageNumber: 1, rowNumber: 3 },
  ];
  assert.equal(resolvePdfIdentity(lines).taxpayerId, "ABCDE1234F");
  assert.equal(resolvePdfIdentity([{ text: "Permanent Account Number (PAN) Aadhaar Number",
    pageNumber: 1, rowNumber: 1 }, { text: "ABCDE1234F XXXX XXXX 1234 Taxpayer",
    pageNumber: 1, rowNumber: 2 }]).taxpayerId, "ABCDE1234F");
  assert.equal(resolvePdfIdentity([...lines, { text: "PAN ZZZZZ9999Z", pageNumber: 2,
    rowNumber: 1 }]).status, "review");
  assert.equal(resolvePdfIdentity([{ text: "12345", pageNumber: 1, rowNumber: 1 }]).status,
    "insufficient_data");
});

test("AIS codes are corroborated by their descriptions and non-income SFT remains distinct", () => {
  assert.equal(classifyAisSection("SFT-O16", "Interest income from savings account"), "SAVINGS_INTEREST");
  assert.equal(classifyAisSection("SFT-016", "Interest from term deposit"), "TERM_DEPOSIT_INTEREST");
  assert.equal(classifyAisSection("SFT-005", "Purchase of time deposit"), "TIME_DEPOSIT_TRANSACTION");
  assert.equal(classifyAisSection("SFT-017", "Interest from term deposit"), "UNCLASSIFIED");
  assert.equal(classifyAisSection("SFT-016", "Purchase of time deposit"), "UNCLASSIFIED");
});

test("printed values preserve decimals and reject impossible dates or conflicting quarters", () => {
  assert.equal(parsePrintedAmount("1,23,456.70"), "123456.70");
  assert.equal(parsePrintedAmount("(1,23,456.70)"), "-123456.70");
  assert.equal(parsePrintedAmount("1,234,56.70"), null);
  assert.equal(parseDocumentDate("29/02/2025"), null);
  assert.equal(parseDocumentDate("2025-02-28")?.financialYear, "2024-2025");
  assert.equal(parseDocumentPeriod("APR-2025")?.financialYear, "2025-2026");
  assert.equal(quarterMatchesDate("Q1(Apr-Jun)", parseDocumentDate("30/04/2025")), true);
  assert.equal(quarterMatchesDate("Q2(Jul-Sep)", parseDocumentDate("30/04/2025")), false);
});

test("unclassified AIS section and malformed visible detail stay traceable", async () => {
  const summary = gridRow(["1", "SFT-017", "Unknown deposit heading", "Bank", "1", "100"], 1);
  const unknownDetail = gridRow(["1", "01/04/2025", "Account", "100", "", "Active"], 2);
  const known = gridRow(["2", "TDS-194Q", "Payment by buyer", "Buyer", "1", "100"], 3);
  const detail = gridRow(["1", "Q1(Apr-Jun)", "31/02/2025", "100", "Active"], 4);
  const state = createAisTableState({ sourceId: "a", originalName: "a.pdf",
    taxpayerId: "ABCDE1234F", financialYear: "2025-2026" });
  await consumeAisGridPage(state, { rows: [summary, unknownDetail, known, detail],
    refineCell: async (row, column) => ({ text: row.cells[column], confidence: 90 }) });
  const result = finishAisTables(state);
  assert.equal(result.unclassifiedSections.length, 1);
  assert.equal(result.unclassifiedSections[0].rawCode, "SFT-017");
  assert.equal(result.rejectedRows.length, 2);
  assert.equal(result.rejectedRows[0].provenance.rowNumber, 2);
  assert.equal(result.rejectedRows[1].provenance.rowNumber, 4);
  assert.equal(Object.hasOwn(result.issues.find((issue) => issue.code === "AIS_UNCLASSIFIED_SECTION_ROW"), "tableId"), false);
  assert.equal(result.tables[0].status, "unverified");
});

test("ambiguous OCR amount is chosen only by a unique printed total", async () => {
  const summary = gridRow(["1", "TDS-194Q", "Payment by buyer", "Buyer", "1", "100.25"], 1);
  const detail = gridRow(["1", "Q1(Apr-Jun)", "30/04/2025", "100.25", "1", "1", "Active"], 2);
  detail.alternateCells = [...detail.cells];
  detail.alternateCells[3] = "100.75";
  const page = { rows: [summary, detail], refineCell: async (row, column) => ({
    text: row.cells[column], confidence: 90,
  }) };
  const state = createAisTableState({ sourceId: "a", originalName: "a.pdf",
    taxpayerId: "ABCDE1234F", financialYear: "2025-2026" });
  await consumeAisGridPage(state, page);
  const result = finishAisTables(state);
  assert.equal(result.records[0].amount, "100.25");
  assert.equal(result.records[0].amountReading.candidates.length, 2);
  assert.equal(result.tables[0].status, "verified");
});

test("text AIS PDFs report when pages are omitted by the extraction limit", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ais-text-limit-"));
  try {
    const filePath = path.join(dir, "AIS.pdf");
    await writePdf(filePath, (doc) => {
      for (let page = 1; page <= 51; page += 1) {
        if (page > 1) doc.addPage();
        doc.text("Annual Information Statement AIS");
        doc.text("Financial Year 2025-2026");
        doc.text("Part A - General Information");
        doc.text("Permanent Account Number PAN ABCDE1234F");
        doc.text("Part B1 - Information relating to tax");
        doc.text(`Readable text page ${page} with enough extracted text to avoid OCR fallback.`);
      }
    });
    const parsed = await parseAisPdf({ filePath, sourceId: "ais-limit", originalName: "AIS.pdf",
      completeExport: true, financialYear: "2025-2026" });
    assert.equal(parsed.status, "insufficient_data");
    assert.equal(parsed.pageCount, 51);
    assert.ok(parsed.issues.some((issue) => issue.code === "AIS_TEXT_PAGE_LIMIT"));
    assert.ok(!parsed.textLines.some((line) => line.page === 51));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("text-layer AIS tables are parsed through structured table controls", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ais-text-table-"));
  try {
    const filePath = path.join(dir, "AIS.pdf");
    await writePdf(filePath, (doc) => {
      const row = (y, cells, widths = [45, 80, 150, 80, 45, 65, 55]) => {
        let x = 36;
        cells.forEach((cell, index) => {
          doc.text(cell, x, y, { width: widths[index] || 60, lineBreak: false });
          x += widths[index] || 60;
        });
      };
      doc.text("Annual Information Statement (AIS)", 36, 36);
      doc.text("Financial Year 2025-2026", 36, 56);
      doc.text("Part A - General Information", 36, 76);
      doc.text("Permanent Account Number PAN ABCDE1234F", 36, 96);
      doc.text("Part B1 - Information relating to tax", 36, 116);
      row(150, ["Sr. No.", "Information Code", "Information Description", "Information Source", "Count", "Amount"],
        [45, 90, 160, 95, 45, 65]);
      row(174, ["1", "TDS-194Q", "Payment by buyer", "Buyer A", "1", "100"],
        [45, 90, 160, 95, 45, 65]);
      row(212, ["SR. NO.", "Quarter", "Transaction Date", "Amount Paid", "Tax Deducted", "Tax Deposited", "Status"]);
      row(236, ["1", "Q1(Apr-Jun)", "30/04/2025", "100", "1", "1", "Active"]);
    });
    const parsed = await parseAisPdf({ filePath, sourceId: "ais-text", originalName: "AIS.pdf",
      completeExport: true, financialYear: "2025-2026" });
    assert.equal(parsed.ocrUsed, false);
    assert.equal(parsed.tables.length, 1);
    assert.equal(parsed.tables[0].status, "verified");
    assert.equal(parsed.records.length, 1);
    assert.equal(parsed.records[0].category, "BUSINESS_RECEIPTS");
    assert.equal(parsed.records[0].amount, "100.00");
    assert.equal(parsed.records[0].taxpayerId, "ABCDE1234F");
    assert.ok(!parsed.issues.some((issue) => issue.code === "AIS_TRANSACTION_MAPPING_UNVERIFIED"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("impossible AIS transaction dates and unresolved amounts remain unverified", async () => {
  const summary = gridRow(["1", "TDS-194Q", "Payment by buyer", "Buyer", "1", "100"], 1);
  const detail = gridRow(["1", "Q1(Apr-Jun)", "31/04/2025", "90", "1", "1", "Active"], 2);
  detail.alternateCells = [...detail.cells];
  detail.alternateCells[3] = "110";
  const state = createAisTableState({ sourceId: "a", originalName: "a.pdf",
    taxpayerId: "ABCDE1234F", financialYear: "2025-2026" });
  await consumeAisGridPage(state, { rows: [summary, detail], refineCell: async (row, column) => ({
    text: row.cells[column], confidence: 90,
  }) });
  const result = finishAisTables(state);
  assert.equal(result.records[0].rawDate, "31/04/2025");
  assert.equal(result.records[0].date, null);
  assert.equal(result.records[0].amount, null);
  assert.equal(result.tables[0].status, "unverified");
});

test("wrapped AIS detail cells are joined without losing the continuation location", async () => {
  const summary = gridRow(["1", "TDS-194Q", "Payment by buyer", "Buyer", "1", "100"], 1);
  const detail = gridRow(["1", "Q1(Apr-Jun)", "30/04/2025", "100", "1", "1", "Active"], 2);
  const continuation = gridRow(["", "", "", "", "", "", ""], 3);
  continuation.cells[1] = "(additional note)";
  const state = createAisTableState({ sourceId: "a", originalName: "a.pdf",
    taxpayerId: "ABCDE1234F", financialYear: "2025-2026" });
  await consumeAisGridPage(state, { rows: [summary, detail, continuation],
    refineCell: async (row, column) => ({ text: row.cells[column], confidence: 90 }) });
  const result = finishAisTables(state);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].wrappedSourceRefs[0].rowNumber, 3);
});

test("AIS detail fields follow a section header when column positions differ", async () => {
  const summary = gridRow(["1", "TDS-194Q", "Payment by buyer", "Buyer", "1", "100"], 1);
  const header = gridRow(["SR. NO.", "Quarter", "Amount Paid", "Transaction Date",
    "TDS Deposited", "TDS Deducted", "Status"], 2);
  const detail = gridRow(["1", "Q1(Apr-Jun)", "100", "30/04/2025", "1", "1", "Active"], 3);
  const state = createAisTableState({ sourceId: "a", originalName: "a.pdf",
    taxpayerId: "ABCDE1234F", financialYear: "2025-2026" });
  await consumeAisGridPage(state, { rows: [summary, header, detail],
    refineCell: async (row, column) => ({ text: row.cells[column], confidence: 90 }) });
  const result = finishAisTables(state);
  assert.equal(result.tables[0].status, "verified");
  assert.equal(result.records[0].amount, "100.00");
  assert.equal(result.records[0].date, "30/04/2025");
  assert.deepEqual(result.records[0].provenance.box, [200, 90, 300, 115]);
});

test("an OCR transaction line outside a detected grid is reported with page and line", async () => {
  const summary = gridRow(["1", "TDS-194Q", "Payment by buyer", "Buyer", "1", "100"], 1);
  const state = createAisTableState({ sourceId: "a", originalName: "a.pdf",
    taxpayerId: "ABCDE1234F", financialYear: "2025-2026" });
  await consumeAisGridPage(state, { pageNumber: 1, rows: [summary],
    ocrLines: [{ pageNumber: 1, rowNumber: 9, text: "1 Q1(Apr-Jun) 30/04/2025 100 Active",
      left: 20, top: 90, right: 400, bottom: 105 }],
    refineCell: async (row, column) => ({ text: row.cells[column], confidence: 90 }) });
  const result = finishAisTables(state);
  assert.equal(result.rejectedRows[0].reason, "AIS_OCR_ROW_OUTSIDE_GRID");
  assert.equal(result.rejectedRows[0].provenance.rowNumber, 9);
  assert.deepEqual(result.rejectedRows[0].provenance.box, [20, 90, 400, 105]);
  assert.equal(result.tables[0].status, "unverified");
});
