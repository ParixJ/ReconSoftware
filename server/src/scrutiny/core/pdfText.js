import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { AppError } from "../../errors.js";
import { ERROR_CODES } from "../../api/errorCodes.js";
import { readAisGrid } from "./aisGrid.js";

const MAX_TEXT_PAGES = 50;
const MAX_TEXT_ITEMS = 200_000;
const require = createRequire(import.meta.url);
const languagePath = path.join(path.dirname(require.resolve("@tesseract.js-data/eng")), "4.0.0");
let supportingOcrActive = false;

export async function readPdfLines(filePath) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({ data: new Uint8Array(await fs.readFile(filePath)), useSystemFonts: true });
  try {
    const document = await loadingTask.promise;
    const lines = [];
    let itemCount = 0;
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, MAX_TEXT_PAGES); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      itemCount += content.items.length;
      if (itemCount > MAX_TEXT_ITEMS) throw new Error("The PDF contains too many text items.");
      const byPosition = new Map();
      for (const item of content.items) {
        const value = item.str?.trim();
        if (!value) continue;
        const vertical = Math.round(item.transform[5]);
        if (!byPosition.has(vertical)) byPosition.set(vertical, []);
        byPosition.get(vertical).push({ x: item.transform[4], width: item.width || 0,
          height: item.height || 0, value });
      }
      let rowNumber = 0;
      for (const [vertical, items] of [...byPosition].sort((left, right) => right[0] - left[0])) {
        const ordered = items.sort((left, right) => left.x - right.x);
        const cells = ordered.map((item) => item.value);
        const lefts = ordered.map((item) => item.x);
        const rights = ordered.map((item) => item.x + Math.max(item.width, 1));
        const bounds = [lefts[0] - 1];
        for (let index = 0; index < ordered.length - 1; index += 1) {
          bounds.push((rights[index] + lefts[index + 1]) / 2);
        }
        bounds.push(rights.at(-1) + 1);
        lines.push({ pageNumber, rowNumber: ++rowNumber, cells, text: cells.join(" "),
          top: vertical - Math.max(...ordered.map((item) => item.height || 10)),
          bottom: vertical + 2,
          bounds: bounds.length === cells.length + 1 ? bounds : [
            ordered[0]?.x || 0,
            ...ordered.map((item) => item.x + Math.max(item.width, 1)),
          ] });
      }
      page.cleanup();
    }
    return { lines, pageCount: document.numPages, truncated: document.numPages > MAX_TEXT_PAGES };
  } finally {
    await loadingTask.destroy();
  }
}

export async function readScannedPdfLines(filePath, maxPages = 10) {
  if (supportingOcrActive) throw new AppError(429, ERROR_CODES.AUDIT_OCR_BUSY,
    "Another supporting PDF is being OCR-processed. Retry shortly.");
  supportingOcrActive = true;
  let worker;
  let task;
  try {
    const [{ getDocument }, { createWorker }] = await Promise.all([
      import("pdfjs-dist/legacy/build/pdf.mjs"), import("tesseract.js"),
    ]);
    task = getDocument({ data: new Uint8Array(await fs.readFile(filePath)) });
    const document = await task.promise;
    worker = await createWorker("eng", 1, { langPath: languagePath, cacheMethod: "none" });
    const lines = [];
    const textPages = [];
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, maxPages); pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const grid = await readAisGrid(page, worker, pageNumber);
      textPages.push(grid.text);
      for (const [index, row] of grid.rows.entries()) lines.push({ pageNumber,
        rowNumber: index + 1, cells: row.cells, text: row.cells.join(" "),
        confidence: grid.confidence });
      page.cleanup();
    }
    const ocrTextLines = textPages.flatMap((text, index) => text.split(/\r?\n/).map((line, rowIndex) => ({
      pageNumber: index + 1, rowNumber: rowIndex + 1, text: line.trim(),
    })).filter((line) => line.text));
    return { lines, pageCount: document.numPages, truncated: document.numPages > maxPages,
      ocrUsed: true, fullText: textPages.join("\n"), ocrTextLines };
  } finally {
    await worker?.terminate();
    await task?.destroy();
    supportingOcrActive = false;
  }
}
