import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { parse as parseCsv } from "csv-parse/sync";
import { XMLParser } from "fast-xml-parser";
import { config } from "../../config.js";
import { decodeJsonText } from "./tallyJson.js";
import { fromPaise, toPaise } from "./money.js";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
const OLE = Buffer.from("d0cf11e0a1b11ae1", "hex");
const ZIP = Buffer.from("504b0304", "hex");
const EMPTY = (value) => value === null || value === undefined || String(value).trim() === "";
const clean = (value) => String(value ?? "").trim();

export function fiscalYearOfDate(value) {
  const text = clean(value);
  const iso = /^(20\d{2})(\d{2})(\d{2})$/.exec(text) || /^(20\d{2})-(\d{2})-(\d{2})$/.exec(text);
  const dmy = /^(\d{1,2})[-\/]([A-Za-z]{3}|\d{1,2})[-\/](\d{2,4})$/.exec(text);
  let year;
  let month;
  if (iso) { year = Number(iso[1]); month = Number(iso[2]); }
  else if (dmy) {
    year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    month = Number(dmy[2]) || ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
      .indexOf(dmy[2].toUpperCase()) + 1;
  }
  if (!year || !month || month < 1 || month > 12) return null;
  const start = month >= 4 ? year : year - 1;
  return `${start}-${start + 1}`;
}

export function detectStructuredFormat(buffer) {
  if (buffer.subarray(0, 8).equals(OLE)) return "xls";
  if (buffer.subarray(0, 4).equals(ZIP)) return "xlsx";
  if (buffer.subarray(0, 5).toString() === "%PDF-") return "pdf";
  const head = decodeJsonText(buffer.subarray(0, Math.min(buffer.length, 4096))).trimStart();
  if (head.startsWith("{") || head.startsWith("[")) return "json";
  if (head.startsWith("<?xml") || head.startsWith("<ENVELOPE") || head.startsWith("<TALLY")) return "xml";
  return "csv";
}

export function rowsFromMatrix(matrix, sheetName = null, profile = null) {
  const mapped = Object.values(profile?.fields || {}).map((value) => clean(value).toLowerCase());
  const profileHeader = mapped.length >= 2 ? matrix.findIndex((row) => Array.isArray(row) &&
    mapped.filter((field) => row.some((cell) => clean(cell).toLowerCase() === field)).length >= 2) : -1;
  const autoHeader = matrix.slice(0, 100).findIndex((row) => {
    if (!Array.isArray(row)) return false;
    const labels = row.map((value) => clean(value).toLowerCase().replace(/[^a-z]/g, ""));
    return labels.some((label) => /^(?:ledger|ledgername|ledgeraccount|account|accountname|accounthead|partyname)$/.test(label)) &&
      labels.some((label) => /^(?:debit|debits|dr|dramount|debitamount|debitmovement|credit|credits|cr|cramount|creditamount|creditmovement|openingbalance|closingbalance)$/.test(label));
  });
  const headerAt = profile?.headerRow ? profile.headerRow - 1 : profileHeader >= 0 ? profileHeader :
    autoHeader >= 0 ? autoHeader :
    matrix.findIndex((row) => Array.isArray(row) && row.some((value) => !EMPTY(value)));
  if (headerAt < 0) return [];
  const headers = matrix[headerAt].map((value, column) => clean(value) || `column${column + 1}`);
  if (headers.some((header) => !header) || new Set(headers.map((header) => header.toLowerCase())).size !== headers.length) {
    throw new Error("The table header must contain unique, nonempty column names.");
  }
  return matrix.slice(headerAt + 1).flatMap((cells, index) =>
    !Array.isArray(cells) || !cells.some((value) => !EMPTY(value)) ? [] : [{
      row: Object.fromEntries(headers.map((header, column) => [header, cells[column] ?? ""])),
      rowNumber: headerAt + index + 2, sheetName,
    }]);
}

export function spreadsheetSheets(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", dense: true, cellDates: false, WTF: false });
  let expandedCells = 0;
  return workbook.SheetNames.map((name) => {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false, defval: "" });
    expandedCells += matrix.reduce((total, row) => total + (Array.isArray(row) ? row.length : 0), 0);
    if (expandedCells > config.maxAuditWorkbookCells) {
      throw new Error("AUDIT_SOURCE_LIMIT_EXCEEDED: workbook expanded content exceeds the configured cell limit.");
    }
    return { name, matrix };
  });
}

function rawMatrixRows(sheets) {
  return sheets.flatMap((sheet) => sheet.matrix.flatMap((cells, index) =>
    !Array.isArray(cells) || cells.every(EMPTY) ? [] : [{
      sheetName: sheet.name, rowNumber: index + 1,
      ...Object.fromEntries(cells.map((value, column) => [`column${column + 1}`, value ?? ""])),
    }]));
}

function nodesAtPath(root, selectedPath) {
  if (!selectedPath) return root;
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/u.test(selectedPath)) {
    throw new Error("The record path contains an unsupported selector.");
  }
  return selectedPath.replace(/\[(\d+)\]/g, ".$1").split(".")
    .reduce((value, key) => value?.[key], root);
}

function collectNamed(node, name, output, depth = 0) {
  if (depth > 40 || !node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (key.toUpperCase() === name) output.push(...(Array.isArray(value) ? value : [value]));
    else if (typeof value === "object") {
      for (const entry of Array.isArray(value) ? value : [value]) collectNamed(entry, name, output, depth + 1);
    }
  }
}

function tallyXmlRows(xml) {
  const root = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseTagValue: false,
    removeNSPrefix: true, processEntities: false }).parse(xml);
  const vouchers = [];
  collectNamed(root, "VOUCHER", vouchers);
  const rows = [];
  for (const [voucherIndex, voucher] of vouchers.entries()) {
    const postings = [];
    collectNamed(voucher, "ALLLEDGERENTRIES.LIST", postings);
    collectNamed(voucher, "LEDGERENTRIES.LIST", postings);
    for (const [postingIndex, posting] of postings.entries()) {
      const rawAmount = clean(posting.AMOUNT);
      if (!rawAmount || !clean(posting.LEDGERNAME)) continue;
      const isDeemedPositive = clean(posting.ISDEEMEDPOSITIVE).toLowerCase() === "yes";
      const negative = rawAmount.startsWith("-");
      rows.push({ rowNumber: voucherIndex + 1, postingNumber: postingIndex + 1,
        row: { voucherId: voucher.VOUCHERNUMBER ?? voucher.GUID ?? `${voucher.DATE || ""}:${voucherIndex + 1}`,
          ledger: posting.LEDGERNAME, date: voucher.DATE, voucherType: voucher.VOUCHERTYPENAME,
          narration: voucher.NARRATION, side: isDeemedPositive || negative ? "debit" : "credit",
          amount: rawAmount.replace(/^-/, "") },
        raw: { voucher, posting },
      });
    }
  }
  if (rows.length) return { rows, metadata: { shape: "tally_vouchers" } };
  const ledgers = [];
  collectNamed(root, "LEDGER", ledgers);
  return { rows: ledgers.map((ledger, index) => ({ rowNumber: index + 1,
    row: { ledger: ledger["@NAME"] ?? ledger.NAME, closingBalance: ledger.CLOSINGBALANCE }, raw: ledger })),
    metadata: { shape: "tally_ledger_masters" } };
}

// Header aliases are deliberately limited to column headings, not account names or data cells.
const LEDGER_HEADER_ALIASES = Object.freeze({
  date: /^(?:voucher|transaction|posting|entry|doc(?:ument)?)?\s*date$/i,
  particulars: /^(?:particulars?|details?|description|narration|counterparty)$/i,
  voucherType: /^(?:vch\.?|voucher|transaction|txn|doc(?:ument)?)\s*type$/i,
  voucherId: /^(?:(?:vch\.?|voucher|invoice|bill|doc(?:ument)?|reference|ref)\s*(?:no\.?|number|#))$/i,
  debit: /^(?:debit|dr)(?:\s*(?:amount|amt))?$/i,
  credit: /^(?:credit|cr)(?:\s*(?:amount|amt))?$/i,
});

function ledgerHeader(cells, profile) {
  const columns = {};
  for (const [column, value] of cells.entries()) {
    const label = clean(value).replace(/[\s.]+/g, " ").trim();
    for (const [field, pattern] of Object.entries(LEDGER_HEADER_ALIASES)) {
      if (columns[field] === undefined && pattern.test(label)) columns[field] = column;
    }
    for (const [field, configured] of Object.entries(profile?.fields || {})) {
      if (label.toLowerCase() === clean(configured).toLowerCase()) columns[field] = column;
    }
  }
  return columns.date !== undefined && columns.particulars !== undefined &&
    (columns.debit !== undefined || columns.credit !== undefined) ? columns : null;
}

function sectionTitle(cells, profile) {
  for (let column = 0; column < Math.min(cells.length, 3); column += 1) {
    const label = clean(cells[column]);
    const titled = /^(?:ledger\s*[:\-]|account\s+statement\s+for\s+)\s*(.*)$/i.exec(label);
    const configured = profile?.sectionMarker && label.toLowerCase().startsWith(profile.sectionMarker.toLowerCase());
    if (!titled && !configured) continue;
    const suffix = titled ? titled[1] : label.slice(profile.sectionMarker.length).trim();
    const ledger = suffix || clean(cells[profile?.ledgerNameColumn ?? column + 1]);
    return ledger || null;
  }
  return null;
}

function ledgerSectionRows(sheets, profile = null) {
  const rows = [];
  const sections = [];
  const issues = [];
  let detected = 0;
  for (const sheet of sheets) {
    const matrix = sheet.matrix;
    const starts = matrix.flatMap((cells, index) => Array.isArray(cells) && sectionTitle(cells, profile) ? [index] : []);
    detected += starts.length;
    if (!starts.length) continue;
    let entityName = clean(matrix.slice(0, starts[0]).find((cells) =>
      Array.isArray(cells) && cells.some((value) => !EMPTY(value)))?.find((value) => !EMPTY(value))) || null;
    for (let section = 0; section < starts.length; section += 1) {
      const start = starts[section];
      const end = starts[section + 1] ?? matrix.length;
      for (const cells of matrix.slice(section ? starts[section - 1] + 1 : 0, start)) {
        const heading = Array.isArray(cells) && cells.slice(0, 3)
          .map((value) => /^(?:company|entity|organisation|organization)\s*:\s*(.+)$/i.exec(clean(value)))
          .find(Boolean);
        if (heading) entityName = heading[1].trim();
      }
      const ledger = sectionTitle(matrix[start], profile);
      const headerIndex = matrix.findIndex((cells, index) => index > start && index < Math.min(end, start + 101) &&
        Array.isArray(cells) && ledgerHeader(cells, profile));
      if (headerIndex < 0) {
        issues.push({ code: "AUDIT_LEDGER_HEADER_MISSING", rowNumber: start + 1,
          message: `No recognizable posting header was found within 100 rows of ${ledger}.` });
        continue;
      }
      const header = ledgerHeader(matrix[headerIndex], profile);
      const address = matrix.slice(start + 1, headerIndex).flatMap((cells) =>
        Array.isArray(cells) ? cells.map(clean).filter((value) => value &&
          !/^\d{1,2}[-\/]\w{1,3}[-\/]\d{2,4}\s+to\s+/i.test(value)) : []);
      sections.push({ ledger, entityName, address, sheetName: sheet.name,
        startRow: start + 1, headerRow: headerIndex + 1, endRow: end });
      for (let index = headerIndex + 1; index < end; index += 1) {
        const cells = matrix[index];
        if (!Array.isArray(cells) || cells.every(EMPTY)) continue;
        const date = clean(cells[header.date]);
        const debit = clean(cells[header.debit]);
        const credit = clean(cells[header.credit]);
        const particulars = clean(cells[header.particulars]);
        const detailColumn = /^(?:Dr|Cr)$/i.test(particulars) ? header.particulars + 1 : header.particulars;
        const detail = clean(cells[detailColumn]);
        const kind = /^opening\s+balance$/i.test(detail) ? "opening" :
          /^closing\s+balance$/i.test(detail) ? "closing" : "movement";
        if (!debit && !credit || kind === "movement" && !/^\d{1,2}[-\/]\w{1,3}[-\/]\d{2,4}$/.test(date)) continue;
        rows.push({ rowNumber: index + 1, sheetName: sheet.name, row: {
          ledger, entityName, date, debit, credit, kind, counterparty: detail,
          voucherType: clean(cells[header.voucherType]), voucherId: clean(cells[header.voucherId]),
        } });
      }
    }
  }
  return { rows, sections, issues, detected };
}

export async function readStructuredLedger({ filePath, profile = null }) {
  const buffer = await fs.readFile(filePath);
  const format = detectStructuredFormat(buffer);
  if (format === "pdf") throw new Error("Ledger PDFs are not a supported structured ledger format.");
  if (format === "xml") return { format, ...tallyXmlRows(decodeJsonText(buffer)), sheets: [] };
  if (format === "json") {
    const payload = JSON.parse(decodeJsonText(buffer));
    const selected = nodesAtPath(payload, profile?.recordsPath);
    const collection = Array.isArray(selected) ? selected : selected?.records ?? selected?.vouchers ?? selected?.ledgers;
    if (!Array.isArray(collection)) throw new Error("No record array was found; select its JSON path in a mapping profile.");
    const rows = collection.flatMap((row, index) => {
      if (!row || typeof row !== "object") return [{ rowNumber: index + 1, row: {}, raw: row }];
      if (!Array.isArray(row.postings)) return [{ rowNumber: index + 1, row, raw: row }];
      const context = { ...row }; delete context.postings;
      // Voucher totals are not per-posting facts.
      delete context.incomeAmount; delete context.taxableValue;
      return row.postings.map((posting, postingIndex) => ({ rowNumber: index + 1,
        postingNumber: postingIndex + 1, row: { ...context, ...posting }, raw: { voucher: row, posting } }));
    });
    return { format, sheets: [], rows, rawRows: collection, metadata: { financialYear: payload.financialYear ?? payload.fiscalYear,
      taxpayerId: payload.taxpayerId, completeExport: payload.completeExport } };
  }
  if (format === "csv") {
    const matrix = parseCsv(decodeJsonText(buffer), { bom: true, skip_empty_lines: true, relax_column_count: true });
    return { format, sheets: [{ name: "CSV", matrix }], rows: rowsFromMatrix(matrix, "CSV", profile),
      rawRows: rawMatrixRows([{ name: "CSV", matrix }]), metadata: {} };
  }
  const sheets = spreadsheetSheets(buffer);
  const selected = profile?.sheetNames?.length ? sheets.filter((sheet) => profile.sheetNames.includes(sheet.name)) : sheets;
  if (!selected.length) throw new Error("The mapping profile does not select a sheet in this workbook.");
  const sections = profile?.layout === "flat" ? { rows: [], sections: [], issues: [], detected: 0 } :
    ledgerSectionRows(selected, profile);
  if (profile?.layout === "ledger_sections" && !sections.detected) {
    throw new Error("The profile selected ledger sections, but no matching sections were found.");
  }
  const flatIssues = [];
  const flatRows = sections.detected ? sections.rows : selected.flatMap((sheet) => {
    try { return rowsFromMatrix(sheet.matrix, sheet.name, profile); } catch (error) {
      flatIssues.push({ code: "AUDIT_TABLE_HEADER_INVALID", sheetName: sheet.name,
        message: `Sheet ${sheet.name} could not be mapped: ${error.message}` });
      return [];
    }
  });
  return { format, sheets: selected, rawRows: rawMatrixRows(selected), rows: flatRows,
    metadata: { shape: sections.detected ? "ledger_sections" : "flat",
      ledgerStatements: sections.sections, extractionIssues: [...sections.issues, ...flatIssues] } };
}

// A ledger-section export describes one side of each posting. Its absence of
// opening/closing control lines is evidence missing, not a zero balance.
export function normalizeLedgerSections({ rows, rawRows = null, sourceId, originalName, format, financialYear,
  taxpayerId, completeExport, accountRoles = {}, ledgerStatements = [], extractionIssues = [] }) {
  const grouped = new Map();
  const issues = [...extractionIssues];
  const coverageYears = [...new Set(rows.map((item) => fiscalYearOfDate(item.row.date)).filter(Boolean))].sort();
  const selectedYear = coverageYears.length > 1 ? financialYear : coverageYears[0] || financialYear;
  if (coverageYears.length > 1 && !coverageYears.includes(financialYear)) issues.push({
    code: "AUDIT_PERIOD_MISMATCH", message: "This cross-year ledger has no entries in the selected report year." });
  for (const item of rows) {
    if (coverageYears.length > 1 && fiscalYearOfDate(item.row.date) !== financialYear) continue;
    const ledger = clean(item.row.ledger);
    if (!ledger) continue;
    let debit;
    let credit;
    try {
      debit = EMPTY(item.row.debit) ? null : toPaise(item.row.debit);
      credit = EMPTY(item.row.credit) ? null : toPaise(item.row.credit);
      if (debit !== null && credit !== null || debit === null && credit === null || debit < 0n || credit < 0n) {
        throw new Error("One nonnegative debit or credit amount is required.");
      }
    } catch {
      issues.push({ code: "INVALID_AUDIT_ROW", rowNumber: item.rowNumber,
        message: "Ledger movement has an invalid debit/credit amount." });
      continue;
    }
    const entityName = clean(item.row.entityName) || null;
    const key = `${entityName || ""}\0${ledger.toLocaleUpperCase("en-IN")}`;
    if (!grouped.has(key)) grouped.set(key, { ledger, debits: 0n, credits: 0n, entries: [],
      entityName, provenance: { sourceId, originalName, rowNumber: item.rowNumber, sheetName: item.sheetName } });
    const group = grouped.get(key);
    if (item.row.kind === "opening" || item.row.kind === "closing") {
      // Tally displays the closing control on the opposite, balancing side.
      const displayed = (debit ?? 0n) - (credit ?? 0n);
      const value = item.row.kind === "closing" ? -displayed : displayed;
      const field = item.row.kind === "opening" ? "openingBalance" : "closingBalance";
      if (group[field] !== undefined) issues.push({ code: "AUDIT_LEDGER_BALANCE_DUPLICATE",
        rowNumber: item.rowNumber, message: `A ${item.row.kind} balance appears more than once for ${ledger}.` });
      else group[field] = fromPaise(value);
      continue;
    }
    group.debits += debit ?? 0n;
    group.credits += credit ?? 0n;
    group.entries.push({ side: debit !== null ? "debit" : "credit",
      amount: fromPaise(debit ?? credit), date: clean(item.row.date),
      voucherId: clean(item.row.voucherId) || null, voucherType: clean(item.row.voucherType) || null,
      counterparty: clean(item.row.counterparty) || null,
      provenance: { sourceId, originalName, rowNumber: item.rowNumber, sheetName: item.sheetName } });
  }
  const records = [...grouped.values()].map((group) => ({ ...group,
    debits: fromPaise(group.debits), credits: fromPaise(group.credits),
    accountRole: accountRoles[group.ledger] ?? accountRoles[group.ledger.toUpperCase()] ?? null }));
  if (!records.length) issues.push({ code: "EMPTY_AUDIT_SOURCE", message: "No ledger movements were found." });
  if (!completeExport) issues.push({ code: "AUDIT_EXPORT_COMPLETENESS_UNCONFIRMED",
    message: "Export completeness has not been confirmed." });
  const entityNames = [...new Set(ledgerStatements.map((section) => section.entityName).filter(Boolean))];
  if (entityNames.length > 1) issues.push({ code: "AUDIT_MULTIPLE_ENTITIES",
    message: "The workbook contains more than one company; select an approved entity mapping before comparison." });
  return { sourceId, role: "books_ledgers", originalName, format, financialYear: selectedYear || null,
    coverageYears, entityName: entityNames.length === 1 ? entityNames[0] : null,
    ledgerStatements,
    taxpayerId: taxpayerId || null, completeExport: completeExport === true,
    status: issues.length ? "insufficient_data" : "ready", recordCount: records.length,
    records, rawRows: rawRows || rows.map((item) => ({ ...item.row, provenance: {
      sourceId, originalName, rowNumber: item.rowNumber, sheetName: item.sheetName } })), issues };
}
