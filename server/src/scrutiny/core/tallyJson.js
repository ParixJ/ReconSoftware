import fs from "node:fs/promises";
import { fromPaise, toPaise } from "./money.js";

const MONTHS = new Map(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  .map((month, index) => [month.toUpperCase(), index + 1]));

export function decodeJsonText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString("utf16le").replace(/^\uFEFF/, "");
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

// Tally's sample multi-ledger export repeats object keys instead of using arrays
// and includes bare Dr/Cr and dollar-denominated amounts. A strict, bounded
// parser preserves every repeated field without evaluating source text.
export function parseTallyJsonText(text) {
  let index = 0;
  const warnings = { duplicateKeys: 0, bareDirections: 0, currencyTokens: 0 };
  const skipSpace = () => { while (/\s/.test(text[index] || "")) index += 1; };
  const fail = (message) => { throw new Error(`${message} at offset ${index}.`); };
  const string = () => {
    const start = index++;
    while (index < text.length) {
      if (text[index] === "\\") { index += 2; continue; }
      if (text[index++] === '"') return JSON.parse(text.slice(start, index));
    }
    fail("Unterminated string");
  };
  const scalar = () => {
    const start = index;
    while (index < text.length && !/[\s,}\]]/.test(text[index])) index += 1;
    const token = text.slice(start, index);
    if (token === "Dr" || token === "Cr") { warnings.bareDirections += 1; return token; }
    if (/^-?\$[\d,]+(?:\.\d+)?$/.test(token)) { warnings.currencyTokens += 1; return token; }
    try { return JSON.parse(token); } catch { fail("Invalid JSON value"); }
  };
  const parseValue = (depth = 0) => {
    if (depth > 64) fail("JSON nesting is too deep");
    skipSpace();
    if (text[index] === '"') return string();
    if (text[index] === "[") {
      index += 1;
      const values = [];
      skipSpace();
      if (text[index] === "]") { index += 1; return values; }
      while (index < text.length) {
        values.push(parseValue(depth + 1));
        skipSpace();
        if (text[index] === "]") { index += 1; return values; }
        if (text[index++] !== ",") fail("Expected array separator");
      }
      fail("Unterminated array");
    }
    if (text[index] === "{") {
      index += 1;
      const fields = new Map();
      skipSpace();
      if (text[index] === "}") { index += 1; return {}; }
      while (index < text.length) {
        skipSpace();
        if (text[index] !== '"') fail("Expected object key");
        const key = string();
        skipSpace();
        if (text[index++] !== ":") fail("Expected key separator");
        const value = parseValue(depth + 1);
        if (fields.has(key)) {
          fields.get(key).push(value);
          warnings.duplicateKeys += 1;
        } else fields.set(key, [value]);
        skipSpace();
        if (text[index] === "}") {
          index += 1;
          return Object.fromEntries([...fields].map(([name, values]) =>
            [name, values.length === 1 ? values[0] : values]));
        }
        if (text[index++] !== ",") fail("Expected object separator");
      }
      fail("Unterminated object");
    }
    return scalar();
  };
  const data = parseValue();
  skipSpace();
  if (index !== text.length) fail("Unexpected trailing content");
  if (!data || typeof data !== "object" || Array.isArray(data) || !data.mlvbody) {
    throw new Error("Expected a Tally multi-ledger export.");
  }
  return { data, warnings };
}

export async function readTallyJson(filePath) {
  return parseTallyJsonText(decodeJsonText(await fs.readFile(filePath)));
}

function ledgerNodes(data) {
  const nodes = data.mlvbody?.mlvledbody;
  return Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];
}

function detailsFor(node) {
  const details = node?.lvacctitle?.lvacctitle?.lvbody?.dspvchdetail;
  return Array.isArray(details) ? details : details ? [details] : [];
}

function fiscalYearOf(date) {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(String(date || ""));
  const month = match && MONTHS.get(match[2].toUpperCase());
  if (!month) return null;
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${start + 1}`;
}

function cleanAmount(value, context, issues) {
  try { return fromPaise(toPaise(value)); }
  catch {
    issues.push({ code: "INVALID_AUDIT_ROW", message: `${context} has an invalid monetary value.` });
    return null;
  }
}

export function normalizeTallyJson({ data, warnings, role, sourceId, originalName, completeExport,
  financialYear, normalizeRows }) {
  const nodes = ledgerNodes(data);
  const issues = [];
  const years = new Set();
  const parseWarnings = [];
  if (warnings.duplicateKeys || warnings.bareDirections || warnings.currencyTokens) {
    parseWarnings.push(`Non-standard Tally JSON was read without discarding repeated fields (${warnings.duplicateKeys} repeated keys, ${warnings.bareDirections} bare Dr/Cr tokens, ${warnings.currencyTokens} currency tokens).`);
  }
  if (!nodes.length) issues.push({ code: "EMPTY_AUDIT_SOURCE", message: "No ledger statements were found." });
  const ledgerRows = [];
  const voucherRows = [];
  const voucherTotals = new Map();
  const seenLedgers = new Set();
  for (const [ledgerIndex, node] of nodes.entries()) {
    const title = node?.lvacctitle?.lvacctitle?.lvacctitle;
    const ledger = typeof title === "string" ? title.trim() : "";
    if (!ledger) {
      issues.push({ code: "INVALID_AUDIT_ROW", rowNumber: ledgerIndex + 1,
        message: "A Tally ledger title is missing." });
      continue;
    }
    const ledgerKey = ledger.toLocaleUpperCase("en-IN");
    if (seenLedgers.has(ledgerKey)) issues.push({ code: "DUPLICATE_AUDIT_LEDGER", rowNumber: ledgerIndex + 1,
      message: `The Tally ledger ${ledger} appears more than once.` });
    seenLedgers.add(ledgerKey);
    let debitTotal = 0n;
    let creditTotal = 0n;
    const details = detailsFor(node);
    for (const [postingIndex, detail] of details.entries()) {
      const year = fiscalYearOf(detail.dspvchdate);
      if (year) years.add(year);
      const number = detail.dspvchnumber?.dspvchnumber?.dspexplvchnumber;
      const voucherId = [detail.dspvchdate, detail.dspvchtype, number]
        .map((part) => String(part ?? "").trim()).join(" | ");
      const debit = detail.dspvchdramt;
      const credit = detail.dspvchcramt;
      if (!number || (debit == null) === (credit == null)) {
        issues.push({ code: "INVALID_AUDIT_ROW", rowNumber: ledgerIndex + 1,
          message: `A posting in Tally ledger ${ledger} lacks a unique voucher number or one debit/credit side.` });
        continue;
      }
      const signedAmount = cleanAmount(debit ?? credit, `A posting in Tally ledger ${ledger}`, issues);
      if (signedAmount === null) continue;
      const signedPaise = toPaise(signedAmount);
      const paise = signedPaise < 0n ? -signedPaise : signedPaise;
      const amount = fromPaise(paise);
      if (debit != null) debitTotal += paise;
      else creditTotal += paise;
      const totals = voucherTotals.get(voucherId) || { debit: 0n, credit: 0n };
      if (debit != null) totals.debit += paise;
      else totals.credit += paise;
      voucherTotals.set(voucherId, totals);
      const narration = detail.vchlednarrexplosion?.vchlednarrexplosion?.vchlednarrexplosion;
      voucherRows.push({ rowNumber: ledgerIndex + 1, postingNumber: postingIndex + 1,
        row: { voucherId, ledger, side: debit != null ? "debit" : "credit",
          amount, date: String(detail.dspvchdate ?? ""),
          voucherType: String(detail.dspvchtype ?? ""),
          counterparty: String(detail.dspvchledaccount ?? ""),
          narration: typeof narration === "string" ? narration : "" } });
    }
    const closing = node?.lvacctitle?.lvacctitle?.lvbody?.lvclosingbalance;
    ledgerRows.push({
      ledger, debits: fromPaise(debitTotal), credits: fromPaise(creditTotal),
      reportedDebitTotal: closing?.lvfcthree?.lvsubdrtotal ?? null,
      reportedCreditTotal: closing?.lvfcthree?.lvsubcrtotal ?? null,
      voucherCount: details.length,
      provenance: { sourceId, originalName, rowNumber: ledgerIndex + 1 },
    });
  }
  if (years.size > 1) issues.push({ code: "AUDIT_PERIOD_MISMATCH",
    message: "Tally ledger postings span multiple fiscal years." });
  const observedYear = years.size === 1 ? [...years][0] : financialYear;
  if (role === "books_vouchers") {
    const parsed = normalizeRows({ rows: voucherRows, role, sourceId, originalName,
      format: "json", financialYear: observedYear, completeExport });
    const unbalanced = [...voucherTotals.values()].filter((item) => item.debit !== item.credit).length;
    if (unbalanced) issues.push({ code: "TALLY_VOUCHER_COVERAGE_INCOMPLETE",
      message: `${unbalanced} of ${voucherTotals.size} voucher groups are unbalanced in this ledger export; a complete voucher set cannot be established.` });
    parsed.issues.push(...issues);
    parsed.parseWarnings = parseWarnings;
    parsed.ledgerStatements = ledgerRows;
    if (issues.length) parsed.status = "insufficient_data";
    return parsed;
  }
  issues.push({ code: "TALLY_OPENING_BALANCE_UNAVAILABLE",
    message: "This Tally ledger export does not identify opening balances, so ledger roll-forward checks cannot be marked as matched." });
  if (completeExport !== true) issues.push({ code: "AUDIT_EXPORT_COMPLETENESS_UNCONFIRMED",
    message: "Export completeness has not been confirmed." });
  return { sourceId, role, originalName, format: "json", financialYear: observedYear || null,
    taxpayerId: null, completeExport: completeExport === true, status: "insufficient_data",
    recordCount: ledgerRows.length, records: ledgerRows, issues, parseWarnings };
}
