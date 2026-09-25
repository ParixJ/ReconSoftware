import { fromPaise, toPaise } from "./money.js";

const TITLE = /^Account Statement For\s+(.+)$/i;
const PERIOD = /^From\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+To\s+(\d{1,2}\/\d{1,2}\/\d{4})$/i;

function cell(row, column) {
  return String(row?.[column] ?? "").trim();
}

function amount(row, column, rowNumber, issues) {
  const value = row?.[column];
  if (value === null || value === undefined || value === "") return null;
  try { return toPaise(value); }
  catch { issues.push({ code: "INVALID_AUDIT_ROW", rowNumber,
    message: `Column ${column + 1} contains an invalid amount.` }); return null; }
}

function pairedHeader(row) {
  const labels = row?.map((value) => String(value ?? "").trim()) || [];
  const credit = labels.findIndex((value) => /^(?:credit|cr)(?:\s*(?:amount|amt))?$/i.test(value));
  const debit = labels.findIndex((value) => /^(?:debit|dr)(?:\s*(?:amount|amt))?$/i.test(value));
  if (credit < 0 || debit < 0 || credit === debit) return null;
  const detail = (column) => labels.findIndex((value, index) => index > column &&
    /^(?:particulars?|details?|narration)$/i.test(value));
  const creditDetail = detail(credit);
  const debitDetail = detail(debit);
  return creditDetail >= 0 && debitDetail > creditDetail ?
    { credit, creditDetail, debit, debitDetail } : null;
}

export function isMultiLedgerWorkbook(rows) {
  return rows.some((row) => TITLE.test(cell(row, 0))) &&
    rows.slice(0, 100).some((row) => pairedHeader(row));
}

export function normalizeMultiLedgerWorkbook({ rows, sourceId, originalName, completeExport, fiscalYear, normalizeRows }) {
  const starts = rows.flatMap((row, index) => TITLE.test(cell(row, 0)) ? [index] : []);
  const issues = [];
  const normalizedRows = [];
  const years = new Set();
  const ledgers = new Set();
  const entriesByLedger = new Map();
  const entityName = cell(rows[0], 0).replace(/\s+\d{1,2}\.\d{1,2}\.20\d{2}\s*$/, "").trim() || null;
  const ledgerStatements = [];

  for (let section = 0; section < starts.length; section += 1) {
    const start = starts[section];
    const end = starts[section + 1] ?? rows.length;
    const ledger = cell(rows[start], 0).match(TITLE)?.[1].trim();
    const ledgerKey = ledger.toLocaleUpperCase("en-IN");
    if (ledgers.has(ledgerKey)) issues.push({ code: "DUPLICATE_AUDIT_LEDGER", rowNumber: start + 1,
      message: `The account statement for ${ledger} appears more than once.` });
    ledgers.add(ledgerKey);
    const period = cell(rows[start + 1], 0).match(PERIOD);
    if (period) {
      const beginYear = Number(period[1].split("/").at(-1));
      const endYear = Number(period[2].split("/").at(-1));
      years.add(`${beginYear}-${endYear}`);
    } else issues.push({ code: "AUDIT_PERIOD_UNREADABLE", rowNumber: start + 2,
      message: "The account statement period could not be read." });
    const header = rows.findIndex((row, index) => index > start && index < Math.min(end, start + 101) &&
      pairedHeader(row));
    if (header < 0) {
      issues.push({ code: "AUDIT_LEDGER_HEADER_MISSING", rowNumber: start + 1,
        message: `The credit/debit headings for ${ledger} were not found.` });
      continue;
    }
    const columns = pairedHeader(rows[header]);
    ledgerStatements.push({ ledger, entityName, address: [], startRow: start + 1,
      headerRow: header + 1, endRow: end });
    let opening = 0n;
    let openingSeen = false;
    let openingCredit = 0n;
    let openingDebit = 0n;
    let debits = 0n;
    let credits = 0n;
    let closing = null;
    let closingCredit = 0n;
    let closingDebit = 0n;
    let totalRow = null;
    const entries = [];
    const openEntries = { credit: null, debit: null };
    const closeEntry = (side) => {
      if (openEntries[side]) entries.push(openEntries[side]);
      openEntries[side] = null;
    };
    const movement = (side, value, label, rowNumber) => {
      closeEntry(side);
      const dated = /^(\d{1,2}\/\d{1,2}\/\d{4})\s+(.+)$/.exec(label);
      openEntries[side] = { side, amount: fromPaise(value), date: dated?.[1] || null,
        voucherType: dated?.[2]?.trim() || null, voucherId: null,
        counterparty: null, billReference: null,
        details: [], provenance: { sourceId, originalName, rowNumber,
          columnNumber: (side === "credit" ? columns.credit : columns.debit) + 1 } };
    };
    const detail = (side, label) => {
      const entry = openEntries[side];
      if (!entry || !label) return;
      entry.details.push(label);
      const bill = /^Bill No\s*(.+)$/i.exec(label);
      const voucher = /^(?:Vou(?:cher)?|Vch\.?)\s*(?:No\.?|Number|#)\s*[:\-]?\s*(.+)$/i.exec(label);
      if (voucher) entry.voucherId = voucher[1].trim();
      else if (bill) entry.billReference = bill[1].trim();
      else if (!entry.counterparty) entry.counterparty = label;
    };
    for (let index = header + 1; index < end; index += 1) {
      const row = rows[index];
      const creditLabel = cell(row, columns.creditDetail);
      const debitLabel = cell(row, columns.debitDetail);
      if (!row?.some((value) => value !== null && value !== undefined && value !== "")) continue;
      const credit = amount(row, columns.credit, index + 1, issues);
      const debit = amount(row, columns.debit, index + 1, issues);
      if (!creditLabel && !debitLabel && (credit !== null || debit !== null)) {
        const expectedCredit = credits + openingCredit + closingDebit;
        const expectedDebit = debits + openingDebit + closingCredit;
        if ((credit !== null && credit !== expectedCredit) ||
            (debit !== null && debit !== expectedDebit)) issues.push({
          code: "AUDIT_LEDGER_SUBTOTAL_INVALID", rowNumber: index + 1,
          message: `An unlabeled subtotal for ${ledger} does not agree with its preceding entries.`,
        });
        if (credit !== null && debit !== null) totalRow = { credit, debit, rowNumber: index + 1 };
        continue;
      }
      if (/opening balance/i.test(creditLabel)) {
        if (!/^CR Opening Balance$/i.test(creditLabel) || credit === null) issues.push({
          code: "AUDIT_LEDGER_BALANCE_INVALID", rowNumber: index + 1,
          message: `The opening credit balance for ${ledger} is invalid.`,
        });
        else { opening -= credit; openingCredit += credit; openingSeen = true; }
      } else if (/closing balance/i.test(creditLabel)) {
        if (!/^DB Closing Balance$/i.test(creditLabel) || credit === null || closing !== null) issues.push({
          code: "AUDIT_LEDGER_BALANCE_INVALID", rowNumber: index + 1,
          message: `The closing debit balance for ${ledger} is invalid or repeated.`,
        });
        else { closing = credit; closingDebit += credit; }
      } else if (credit !== null) {
        credits += credit;
        movement("credit", credit, creditLabel, index + 1);
      } else detail("credit", creditLabel);
      if (/opening balance/i.test(debitLabel)) {
        if (!/^DB Opening Balance$/i.test(debitLabel) || debit === null) issues.push({
          code: "AUDIT_LEDGER_BALANCE_INVALID", rowNumber: index + 1,
          message: `The opening debit balance for ${ledger} is invalid.`,
        });
        else { opening += debit; openingDebit += debit; openingSeen = true; }
      } else if (/closing balance/i.test(debitLabel)) {
        if (!/^CR Closing Balance$/i.test(debitLabel) || debit === null || closing !== null) issues.push({
          code: "AUDIT_LEDGER_BALANCE_INVALID", rowNumber: index + 1,
          message: `The closing credit balance for ${ledger} is invalid or repeated.`,
        });
        else { closing = -debit; closingCredit += debit; }
      } else if (debit !== null) {
        debits += debit;
        movement("debit", debit, debitLabel, index + 1);
      } else detail("debit", debitLabel);
    }
    closeEntry("credit");
    closeEntry("debit");
    if (!totalRow || totalRow.credit !== totalRow.debit) issues.push({
      code: "AUDIT_LEDGER_TOTAL_INVALID", rowNumber: totalRow?.rowNumber ?? start + 1,
      message: `The statement totals for ${ledger} are absent or do not balance.`,
    });
    normalizedRows.push({ rowNumber: start + 1, row: {
      ledger, openingBalance: openingSeen ? fromPaise(opening) : undefined,
      debits: fromPaise(debits), credits: fromPaise(credits),
      closingBalance: closing === null ? undefined : fromPaise(closing),
    } });
    entriesByLedger.set(ledgerKey, entries);
  }

  if (years.size > 1) issues.push({ code: "AUDIT_PERIOD_MISMATCH",
    message: "The workbook contains statements for multiple fiscal years." });
  const parsed = normalizeRows({ rows: normalizedRows, role: "books_ledgers", sourceId,
    originalName, format: "xlsx", financialYear: years.size === 1 ? [...years][0] : fiscalYear,
    completeExport,
    rawRows: rows.flatMap((cells, index) => !Array.isArray(cells) || cells.every((value) =>
      value === null || value === undefined || String(value).trim() === "") ? [] : [{
      ...Object.fromEntries(cells.map((value, column) => [`column${column + 1}`, value ?? ""])),
      provenance: { sourceId, originalName, rowNumber: index + 1 },
    }]) });
  parsed.entityName = entityName;
  parsed.ledgerStatements = ledgerStatements;
  for (const record of parsed.records) {
    record.entityName = entityName;
    record.entries = entriesByLedger.get(record.ledger.toLocaleUpperCase("en-IN")) || [];
  }
  parsed.issues.push(...issues);
  if (issues.length) parsed.status = "insufficient_data";
  return parsed;
}
