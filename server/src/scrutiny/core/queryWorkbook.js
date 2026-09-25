import { normalizeAmount } from "./money.js";

const clean = (value) => String(value ?? "").trim();
const key = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");

function sheetsOf(input) {
  if (Array.isArray(input) && input.every((item) => item && Array.isArray(item.matrix))) return input;
  return [{ name: "Sheet1", matrix: Array.isArray(input) ? input : [] }];
}

function amount(value) {
  if (value === "" || value === null || value === undefined) return null;
  try {
    return normalizeAmount(typeof value === "number" ? value.toFixed(2) : value);
  } catch {
    return null;
  }
}

function rowAmount(row) {
  if (!Array.isArray(row)) return null;
  for (let index = row.length - 1; index >= 0; index -= 1) {
    const parsed = amount(row[index]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function differenceOf(supportAmount, bookAmount) {
  if (!supportAmount || !bookAmount) return null;
  const difference = Number(supportAmount) - Number(bookAmount);
  if (!Number.isFinite(difference)) return null;
  return normalizeAmount(difference.toFixed(2));
}

function rawRowsFor(sheets) {
  return sheets.flatMap((sheet) => sheet.matrix.flatMap((cells, index) =>
    !Array.isArray(cells) || !cells.some(clean) ? [] : [{
      sheetName: sheet.name,
      rowNumber: index + 1,
      ...Object.fromEntries(cells.map((cell, column) => [`column${column + 1}`, cell ?? ""])),
    }]));
}

function financialYearFrom(sheets) {
  const title = sheets.flatMap((sheet) => sheet.matrix.slice(0, 8).flat()).map(clean)
    .find((cell) => /F\.?\s*Y\.?|financial year/i.test(cell)) || "";
  const match = /(?:F\.?\s*Y\.?|financial year)\s*[:.\-]?\s*(20\d{2})\s*[-/]\s*(20\d{2}|\d{2})/i.exec(title);
  return match ? `${match[1]}-${match[2].length === 2 ? match[1].slice(0, 2) + match[2] : match[2]}` : null;
}

function genericLedgerQueryRows(sheet, sourceId, originalName) {
  const matrix = sheet.matrix;
  const headerAt = matrix.findIndex((row) => Array.isArray(row) &&
    row.some((cell) => /^ledger\s+name$/i.test(clean(cell))) &&
    row.some((cell) => /^query$/i.test(clean(cell))));
  if (headerAt < 0) return [];
  const headers = matrix[headerAt].map((cell) => clean(cell).toLowerCase());
  const ledgerAt = headers.findIndex((cell) => cell === "ledger name");
  const queryAt = headers.findIndex((cell) => cell === "query");
  const dateAt = headers.findIndex((cell) => cell === "date");
  const amountAt = headers.findIndex((cell) => cell === "amount");
  return matrix.slice(headerAt + 1).flatMap((row, index) => {
    if (!Array.isArray(row) || !clean(row[ledgerAt]) || !clean(row[queryAt])) return [];
    return [{ kind: "audit_query", queryType: "ledger_query", ledger: clean(row[ledgerAt]),
      query: clean(row[queryAt]), date: dateAt >= 0 ? clean(row[dateAt]) || null : null,
      amount: amountAt >= 0 ? amount(row[amountAt]) : null,
      provenance: { sourceId, originalName, sheetName: sheet.name, rowNumber: headerAt + index + 2 } }];
  });
}

function caseQueryRows(sheet, sourceId, originalName) {
  const records = [];
  const matrix = sheet.matrix;
  for (let index = 0; index < matrix.length; index += 1) {
    const row = matrix[index] || [];
    const subject = clean(row[1]);
    const query = clean(row[2]);
    if ((Number.isInteger(row[0]) || /^\d+$/.test(clean(row[0]))) && subject && query) {
      const record = { kind: "audit_query", queryType: "manual_query", ledger: subject,
        query, provenance: { sourceId, originalName, sheetName: sheet.name, rowNumber: index + 1 } };
      const lookahead = [];
      for (let rowIndex = index + 1; rowIndex < matrix.length; rowIndex += 1) {
        const item = matrix[rowIndex] || [];
        if ((Number.isInteger(item[0]) || /^\d+$/.test(clean(item[0]))) && clean(item[1]) && clean(item[2])) break;
        lookahead.push(item);
      }
      const book = lookahead.find((item) => /as\s+per\s+books/i.test(clean(item?.[2])));
      const support = lookahead.find((item) => /as\s+per\s+(?!books\b)/i.test(clean(item?.[2])));
      const difference = lookahead.find((item) => /^diff(?:erence)?\.?$/i.test(clean(item?.[2])));
      const bookAmount = rowAmount(book);
      const supportAmount = rowAmount(support);
      const differenceAmount = rowAmount(difference) || differenceOf(supportAmount, bookAmount);
      if (bookAmount || supportAmount || differenceAmount) {
        records.push({ ...record, queryType: "manual_amount_difference",
          bookAmount, supportAmount, differenceAmount });
      } else records.push(record);
    }
    if (/description\s+of\s+assets/i.test(subject)) {
      for (let rowIndex = index + 1; rowIndex < matrix.length; rowIndex += 1) {
        const item = matrix[rowIndex] || [];
        const asset = clean(item[1]);
        if (!asset || /^block\s+[a-z]/i.test(asset)) continue;
        const openingWdv = amount(item[3]);
        const depreciation = amount(item[7]);
        const closingWdv = amount(item[8]);
        if (!openingWdv && !depreciation && !closingWdv) continue;
        records.push({ kind: "audit_query", queryType: "depreciation_schedule", asset,
          rate: clean(item[2]) || null, openingWdv, additionsMoreThan180Days: amount(item[4]),
          additionsLessThan180Days: amount(item[5]), deductions: amount(item[6]),
          depreciation, closingWdv,
          provenance: { sourceId, originalName, sheetName: sheet.name, rowNumber: rowIndex + 1 } });
      }
    }
  }
  return records;
}

function openingBalanceRows(sheet, sourceId, originalName) {
  const header = sheet.matrix[0] || [];
  if (!/liabilities/i.test(clean(header[0])) || !/assets/i.test(clean(header[4]))) return [];
  const records = [];
  const sides = [
    { side: "liabilities", ledger: 0, books: 1, report: 2, difference: 3 },
    { side: "assets", ledger: 4, books: 5, report: 6, difference: 7 },
  ];
  for (let index = 1; index < sheet.matrix.length; index += 1) {
    const row = sheet.matrix[index] || [];
    for (const side of sides) {
      const ledger = clean(row[side.ledger]);
      if (!ledger || /^total$/i.test(ledger)) continue;
      const differenceAmount = amount(row[side.difference]);
      if (!differenceAmount || differenceAmount === "0.00") continue;
      records.push({ kind: "audit_query", queryType: "opening_balance_difference",
        ledger, balanceSide: side.side, bookAmount: amount(row[side.books]),
        reportAmount: amount(row[side.report]), differenceAmount,
        provenance: { sourceId, originalName, sheetName: sheet.name, rowNumber: index + 1 } });
    }
  }
  return records;
}

export function isAuditQueryWorkbook(input) {
  return sheetsOf(input).some((sheet) => {
    const text = `${sheet.name}\n${sheet.matrix.slice(0, 20).map((row) =>
      Array.isArray(row) ? row.map(clean).join(" ") : "").join("\n")}`;
    return /ledger\s+name[\s\S]{0,80}\bquery\b/i.test(text) ||
      /scrutiny\s+query|party\s+name\s+query|op\.?\s*bal\.?\s*diff/i.test(text) ||
      sheet.matrix.some((row) => Array.isArray(row) && row.some((cell) => key(cell) === "query"));
  });
}

export function normalizeAuditQueryWorkbook({ matrix, sheets = null, sourceId, originalName,
  completeExport, format, financialYear = null }) {
  const workbookSheets = sheetsOf(sheets || matrix);
  const records = workbookSheets.flatMap((sheet) => [
    ...genericLedgerQueryRows(sheet, sourceId, originalName),
    ...caseQueryRows(sheet, sourceId, originalName),
    ...openingBalanceRows(sheet, sourceId, originalName),
  ]);
  return { sourceId, role: "supporting_document", originalName, format, documentType: "audit_queries",
    financialYear: financialYear || financialYearFrom(workbookSheets), taxpayerId: null,
    completeExport: completeExport === true,
    status: records.length ? "ready" : "insufficient_data", recordCount: records.length, records,
    rawRows: rawRowsFor(workbookSheets),
    issues: records.length ? [] : [{ code: "AUDIT_QUERY_EMPTY", message: "No audit query rows were found." }],
    parseWarnings: ["Audit queries are reviewer tasks, not independent monetary evidence."],
  };
}
