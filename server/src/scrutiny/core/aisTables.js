import { fromPaise, toPaise } from "./money.js";
import { parseDocumentDate, parseDocumentPeriod, parsePrintedAmount, quarterMatchesDate } from "./pdfEvidence.js";

const MONTH = /\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[-\s]*20\d{2}\b/i;
const DATE = /\b(?:\d{1,2}[\/.-]\d{1,2}[\/.-]20\d{2}|\d{1,2}[\/-][A-Za-z]{3}[\/-]20\d{2}|20\d{2}-\d{2}-\d{2})\b/;
const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/i;

function month(value) {
  return parseDocumentPeriod(MONTH.exec(String(value || ""))?.[0])?.label || null;
}

export function classifyAisSection(rawCode, description) {
  const code = String(rawCode || "").toUpperCase().replace(/O/g, "0")
    .replace(/(?<=\d)[IL|](?=\d|$)/g, "1").replace(/[^A-Z0-9]/g, "");
  const label = String(description || "").toUpperCase();
  if (code === "TDS194A" && /INTEREST/.test(label)) return "INTEREST";
  if (code === "TDS194Q" && /PAYMENT|PURCHASE|BUYER/.test(label)) return "BUSINESS_RECEIPTS";
  if (code === "TCS206CE" && /SCRAP|COLLECTED/.test(label)) return "TCS_206CE";
  if (code.startsWith("SFT016") && /INTEREST/.test(label)) {
    if (/SAVING/.test(label)) return "SAVINGS_INTEREST";
    if (/TERM|TIME|FIXED\s+DEPOSIT/.test(label)) return "TERM_DEPOSIT_INTEREST";
    if (/RECURRING/.test(label)) return "RECURRING_DEPOSIT_INTEREST";
  }
  if (code.startsWith("SFT005") && /TERM|TIME|FIXED\s+DEPOSIT/.test(label)) return "TIME_DEPOSIT_TRANSACTION";
  if (code === "EXCGSTR3B" && /SALE|TURNOVER|GSTR/.test(label)) return "EXC-GSTR3B";
  if (code === "EXCGSTR1P" && /PURCHASE|GSTR/.test(label)) return "EXC-GSTR1(P)";
  return "UNCLASSIFIED";
}

function digits(value) {
  const text = String(value || "").trim();
  if (!text || /[A-Za-z]/.test(text)) return null;
  const clean = text.replace(/[,.\s|[\]]/g, "");
  if (!/^\d{1,15}$/.test(clean)) return null;
  return clean.replace(/^0+(?=\d)/, "");
}

async function numberReading(page, row, column, { integer = false } = {}) {
  const readings = [
    { text: row.cells[column], confidence: null, method: "page_ocr" },
    { text: row.alternateCells?.[column], confidence: null, method: "overview_ocr" },
    { ...await page.refineCell(row, column, { numeric: true, threshold: 120 }), method: "cell_ocr_120" },
    { ...await page.refineCell(row, column, { numeric: true, threshold: 150 }), method: "cell_ocr_150" },
  ];
  const candidates = new Map();
  for (const reading of readings) {
    const value = parsePrintedAmount(reading.text, { integer });
    if (!value) continue;
    const previous = candidates.get(value);
    const score = reading.confidence ?? 45;
    if (!previous || score > previous.confidence) {
      candidates.set(value, { value, confidence: score, method: reading.method, raw: reading.text });
    }
  }
  const ordered = [...candidates.values()].sort((a, b) => b.confidence - a.confidence);
  return { value: ordered.length === 1 ? ordered[0].value : null,
    candidates: ordered, raw: row.cells[column] };
}

function sourceRef(sourceId, originalName, row, column = null) {
  return { sourceId, originalName, pageNumber: row.pageNumber,
    rowNumber: row.rowNumber, box: column === null ? [row.bounds[0], row.top, row.bounds.at(-1), row.bottom] :
      [row.bounds[column], row.top, row.bounds[column + 1], row.bottom] };
}

function tableCode(category) {
  return ({ INTEREST: "194A", BUSINESS_RECEIPTS: "194Q", TCS_206CE: "206CE",
    SAVINGS_INTEREST: "SFT-016(SB)", TERM_DEPOSIT_INTEREST: "SFT-016(TD)",
    RECURRING_DEPOSIT_INTEREST: "SFT-016(RD)", TIME_DEPOSIT_TRANSACTION: "SFT-005",
    "EXC-GSTR3B": "EXC-GSTR3B",
    "EXC-GSTR1(P)": "EXC-GSTR1(P)" })[category];
}

function amount(value) {
  return value === null ? null : fromPaise(toPaise(value));
}

function tableActiveRows(table) {
  return table.rows.filter((row) => row.status !== "inactive");
}

function detailColumns(table, cells) {
  const find = (pattern) => cells.findIndex((cell) => pattern.test(cell || ""));
  const tds = ["INTEREST", "BUSINESS_RECEIPTS", "TCS_206CE"].includes(table.category);
  const gst = ["EXC-GSTR3B", "EXC-GSTR1(P)"].includes(table.category);
  const columns = {
    status: find(/\bstatus\b/i),
    date: find(/\b(?:transaction\s+date|date\s+of\s+transaction)\b/i),
    period: find(/\b(?:quarter|tax\s+period|return\s+period)\b/i),
    gstin: find(/\bGSTIN\b/i),
    taxable: find(/\btaxable\s+value\b/i),
    tax: find(/\b(?:tax\s+deducted|tax\s+collected)\b/i),
    deposited: find(/\b(?:tax\s+deposited|amount\s+deposited)\b/i),
  };
  columns.amount = find(tds ? /\b(?:amount\s+(?:paid|received|credited)|transaction\s+amount)\b/i :
    gst ? /\b(?:total\s+amount|amount\s+reported|gross\s+amount)\b/i : /\b(?:transaction\s+amount|amount)\b/i);
  if (Object.values(columns).filter((value) => value >= 0).length < 2) return null;
  return columns;
}

function resolvePrintedControls(table, active) {
  const counts = table.countReading.candidates.filter((candidate) => Number(candidate.value) === active.length);
  if (counts.length !== 1) return;
  table.expectedCount = active.length;
  // Keep at most two paths per total: a second path means the OCR reading is ambiguous.
  let paths = new Map([["0", [[]]]]);
  for (const row of active) {
    const next = new Map();
    for (const [sum, choices] of paths) for (const candidate of row.amountReading.candidates) {
      const total = (BigInt(sum) + toPaise(candidate.value)).toString();
      const existing = next.get(total) || [];
      for (const choice of choices) if (existing.length < 2) existing.push([...choice, candidate]);
      next.set(total, existing);
    }
    paths = next;
    if (paths.size > 20_000) return; // Cannot justify an exponential OCR interpretation.
  }
  const solutions = [];
  for (const control of table.totalReading.candidates) {
    for (const choice of paths.get(toPaise(control.value).toString()) || []) {
      if (solutions.length < 2) solutions.push({ control, choice });
    }
  }
  if (solutions.length !== 1) return;
  const { control, choice } = solutions[0];
  table.expectedAmount = amount(control.value);
  table.totalReading.selectedByControl = control.method;
  active.forEach((row, index) => {
    row.amount = amount(choice[index].value);
    row.amountReading.selectedByControl = choice[index].value;
  });
}

export function createAisTableState({ sourceId, originalName, taxpayerId, financialYear }) {
  return { sourceId, originalName, taxpayerId, financialYear, tables: [], active: null,
    expectingSummary: false, unclassifiedActive: false, unclassifiedSections: [], rejectedRows: [] };
}

export async function consumeAisGridPage(state, page) {
  const joinedRows = [];
  for (const row of page.rows) {
    const previous = joinedRows.at(-1);
    if (previous && !String(row.cells[0] || "").trim() && row.cells.length === previous.cells.length &&
        /^\d{1,4}$/.test(previous.cells[0] || "") &&
        !/^(?:TDS|TCS|SFT|EXC)/i.test(previous.cells[1] || "") &&
        !/\b(?:SR\.?\s*NO|INFORMATION|QUARTER)\b/i.test(row.cells.join(" "))) {
      previous.cells = previous.cells.map((cell, index) => [cell, row.cells[index]].filter(Boolean).join(" "));
      previous.wrappedSourceRefs ||= [];
      previous.wrappedSourceRefs.push(sourceRef(state.sourceId, state.originalName, row));
    } else joinedRows.push(row);
  }
  for (const row of joinedRows) {
    const cells = [...row.cells];
    const alternate = row.alternateCells || [];
    const isInformationHeader = (values) => values.length === 6 &&
      ((/(?:INFORMATION|NFORMATION|NFORMATON)/i.test(values[2] || "") &&
        /(?:CODE|COOH|COE)/i.test(values[1] || "")) ||
        /^C[O0]/i.test((values[4] || "").replace(/[^A-Za-z0-9]/g, "")));
    if (isInformationHeader(cells) || isInformationHeader(alternate)) {
      state.active = null;
      state.unclassifiedActive = false;
      state.expectingSummary = true;
      continue;
    }
    let category = cells.length >= 6 ? classifyAisSection(cells[1], cells[2]) : null;
    if (category === "UNCLASSIFIED" && alternate.length >= 6) {
      const other = classifyAisSection(alternate[1], alternate[2]);
      if (other !== "UNCLASSIFIED") category = other;
    }
    if (category && category !== "UNCLASSIFIED" && classifyAisSection(cells[1], cells[2]) === "UNCLASSIFIED") {
      for (const column of [1, 2, 3]) cells[column] = alternate[column] || cells[column];
    }
    if ((!category || category === "UNCLASSIFIED") && state.expectingSummary && cells.length >= 6) {
      cells[1] = (await page.refineCell(row, 1, { threshold: 120 })).text || cells[1];
      cells[2] = (await page.refineCell(row, 2, { threshold: 120 })).text || cells[2];
      category = classifyAisSection(cells[1], cells[2]);
    }
    const isSummary = cells.length >= 6 && /^\d{1,3}$/.test(cells[0] || "") &&
      /^(?:TDS|TCS|SFT|EXC)/i.test(cells[1] || "");
    if (category && category !== "UNCLASSIFIED" && (state.expectingSummary || isSummary)) {
      const count = await numberReading(page, row, 4, { integer: true });
      const total = await numberReading(page, row, 5);
      const table = { id: `${state.sourceId}:table:${state.tables.length + 1}`,
        informationCode: tableCode(category), rawInformationCode: cells[1] || null,
        rawDescription: cells[2] || null, category, informationSource: cells[3] || null,
        expectedCount: count.value === null ? null : Number(count.value),
        expectedAmount: amount(total.value), countReading: count, totalReading: total,
        rows: [], provenance: sourceRef(state.sourceId, state.originalName, row),
        status: "unverified", issues: [] };
      state.tables.push(table);
      state.active = table;
      state.unclassifiedActive = false;
      state.expectingSummary = false;
      continue;
    }
    if ((state.expectingSummary || isSummary) && cells.some(Boolean)) {
      state.unclassifiedSections.push({ rawCode: cells[1] || null, description: cells[2] || null,
        rawCells: cells, provenance: sourceRef(state.sourceId, state.originalName, row) });
      state.expectingSummary = false;
      state.active = null;
      state.unclassifiedActive = true;
      continue;
    }
    const table = state.active;
    if (!table) {
      if (state.unclassifiedActive && cells.length >= 6 && cells.some(Boolean)) state.rejectedRows.push({
        tableId: null, rawCells: cells, provenance: sourceRef(state.sourceId, state.originalName, row),
        reason: "AIS_UNCLASSIFIED_SECTION_ROW",
      });
      continue;
    }
    if (/\bSR\.?\s*NO\b/i.test(cells[0] || "")) {
      table.columnMap = detailColumns(table, cells);
      if (!table.columnMap) table.issues.push({ code: "AIS_TABLE_HEADER_UNMAPPED",
        message: `${table.informationCode} detail header could not be mapped; legacy positions require review.` });
      continue;
    }
    const column = (name, fallback) => table.columnMap?.[name] >= 0 ? table.columnMap[name] : fallback;
    const statusColumn = column("status", cells.length - 1);
    let statusText = cells[statusColumn] || alternate[statusColumn] || "";
    if (!/\b(?:in)?active\b/i.test(statusText) &&
        ((cells.length === 7 && ["INTEREST", "BUSINESS_RECEIPTS", "TCS_206CE"].includes(table.category)) ||
          (cells.length === 6 && !["INTEREST", "BUSINESS_RECEIPTS", "TCS_206CE"].includes(table.category))) &&
        !/\b(?:SR\.?\s*NO|QUARTER|GSTIN|INFORMATION)\b/i.test(cells[0] || "")) {
      statusText = (await page.refineCell(row, statusColumn, { threshold: 120 })).text;
    }
    const status = /\binactive\b/i.test(statusText) ? "inactive" :
      /\bactive\b/i.test(statusText) ? "active" : null;
    const tds = ["INTEREST", "BUSINESS_RECEIPTS", "TCS_206CE"].includes(table.category);
    const gst = ["EXC-GSTR3B", "EXC-GSTR1(P)"].includes(table.category);
    const candidateRow = Boolean(status) || /^\d{1,4}$/.test(cells[0] || "") ||
      cells.some((cell) => DATE.test(cell || "") || MONTH.test(cell || ""));
    if (!candidateRow) {
      if (cells.length >= (tds ? 7 : 6) && cells.some(Boolean)) state.rejectedRows.push({
        tableId: table.id, rawCells: cells, provenance: sourceRef(state.sourceId, state.originalName, row),
        reason: "AIS_ROW_PATTERN_UNREADABLE",
      });
      continue;
    }
    if ((tds && cells.length < 7) || (!tds && cells.length < 6)) {
      state.rejectedRows.push({ tableId: table.id, rawCells: cells,
        provenance: sourceRef(state.sourceId, state.originalName, row), reason: "AIS_ROW_COLUMNS_UNREADABLE" });
      continue;
    }
    const amountColumn = column("amount", tds ? 3 : table.category === "EXC-GSTR1(P)" ? 4 :
      ["SAVINGS_INTEREST", "TERM_DEPOSIT_INTEREST", "RECURRING_DEPOSIT_INTEREST",
        "TIME_DEPOSIT_TRANSACTION"].includes(table.category) ? 4 : 3);
    const primary = await numberReading(page, row, amountColumn);
    const record = { tableId: table.id, informationCode: table.informationCode,
      category: table.category, taxpayerId: state.taxpayerId,
      financialYear: state.financialYear, status: status || "unreadable", amount: amount(primary.value),
      amountReading: primary, rawCells: cells, wrappedSourceRefs: row.wrappedSourceRefs || [],
      provenance: sourceRef(state.sourceId, state.originalName, row, amountColumn) };
    if (tds) {
      const dateColumn = column("date", 2);
      const periodColumn = column("period", 1);
      const rawDate = DATE.exec(cells[dateColumn] || "")?.[0] || DATE.exec(alternate[dateColumn] || "")?.[0] ||
        DATE.exec((await page.refineCell(row, dateColumn, { threshold: 120 })).text)?.[0] || null;
      const parsedDate = parseDocumentDate(rawDate);
      record.rawDate = rawDate;
      record.date = parsedDate && parsedDate.financialYear === state.financialYear &&
        quarterMatchesDate(cells[periodColumn] || alternate[periodColumn], parsedDate) ? rawDate : null;
      record.period = cells[periodColumn] || null;
      record.taxAmountReading = await numberReading(page, row, column("tax", 4));
      record.depositedAmountReading = await numberReading(page, row, column("deposited", 5));
      record.taxAmount = amount(record.taxAmountReading.value);
      record.depositedAmount = amount(record.depositedAmountReading.value);
    } else if (gst) {
      const periodColumn = column("period", table.category === "EXC-GSTR3B" ? 2 : 3);
      const gstinColumn = column("gstin", 1);
      record.gstin = GSTIN.exec(cells[gstinColumn] || "")?.[0] || GSTIN.exec(alternate[gstinColumn] || "")?.[0] || null;
      record.period = month(cells[periodColumn]) || month(alternate[periodColumn]);
      if (!record.period) record.period = month((await page.refineCell(row,
        periodColumn, { threshold: 120 })).text);
      if (record.period && parseDocumentPeriod(record.period)?.financialYear !== state.financialYear) {
        record.rawPeriod = record.period;
        record.period = null;
      }
      if (table.category === "EXC-GSTR3B") {
        record.taxableAmountReading = await numberReading(page, row, column("taxable", 4));
        record.taxableValue = amount(record.taxableAmountReading.value);
      } else record.supplier = cells[2] || null;
    } else {
      record.rawDate = DATE.exec(cells[column("date", 1)] || "")?.[0] || null;
      record.date = parseDocumentDate(record.rawDate)?.financialYear === state.financialYear ? record.rawDate : null;
      record.account = cells[2] || null;
    }
    table.rows.push(record);
  }
  for (const line of page.ocrLines || []) {
    const center = (line.top + line.bottom) / 2;
    if (page.rows.some((row) => center >= row.top - 3 && center <= row.bottom + 3)) continue;
    if (!/\b(?:IN)?ACTIVE\b/i.test(line.text) ||
        ![DATE, MONTH, GSTIN].some((pattern) => pattern.test(line.text))) continue;
    const table = state.tables.filter((item) => item.provenance.pageNumber === page.pageNumber &&
      item.provenance.box[1] <= line.top).at(-1);
    if (!table) continue;
    state.rejectedRows.push({ tableId: table.id, rawCells: [line.text],
      provenance: { sourceId: state.sourceId, originalName: state.originalName,
        pageNumber: page.pageNumber, rowNumber: line.rowNumber,
        box: [line.left, line.top, line.right, line.bottom] },
      reason: "AIS_OCR_ROW_OUTSIDE_GRID" });
  }
  return state;
}

export function finishAisTables(state) {
  const records = [];
  const issues = [];
  const warnings = [];
  for (const table of state.tables) {
    const active = tableActiveRows(table);
    resolvePrintedControls(table, active);
    const rejected = state.rejectedRows.filter((row) => row.tableId === table.id);
    if (rejected.length || table.rows.some((row) => row.status === "unreadable")) {
      table.issues.push({ code: "AIS_TABLE_ROWS_UNREADABLE",
        message: `${table.informationCode} has ${rejected.length} rejected and ${table.rows.filter((row) => row.status === "unreadable").length} status-unreadable row(s).`,
        sourceRefs: rejected.map((row) => row.provenance) });
    }
    if (table.expectedCount !== active.length) table.issues.push({ code: "AIS_TABLE_COUNT_MISMATCH",
      message: `${table.informationCode} has ${active.length} active rows; the printed count reads ${table.expectedCount ?? "unreadable"}.` });
    const sum = active.every((row) => row.amount !== null) ?
      active.reduce((total, row) => total + toPaise(row.amount), 0n) : null;
    const difference = sum === null || table.expectedAmount === null ? null :
      sum - toPaise(table.expectedAmount);
    const wholeRupeeRows = active.every((row) => row.amount !== null &&
      toPaise(row.amount) % 100n === 0n);
    const printedRounding = difference !== null && difference !== 0n &&
      active.length > 1 && wholeRupeeRows &&
      toPaise(table.expectedAmount) % 100n === 0n &&
      difference >= -100n && difference <= 100n;
    if (difference === null || difference !== 0n && !printedRounding) {
      table.issues.push({ code: "AIS_TABLE_AMOUNT_MISMATCH",
        message: `${table.informationCode} detail amounts do not agree with its printed control total.` });
    }
    if (printedRounding) {
      table.roundingDifferenceAmount = fromPaise(difference);
      warnings.push({ code: "AIS_TABLE_ROUNDING_DIFFERENCE", tableId: table.id,
        pageNumber: table.provenance.pageNumber,
        message: `${table.informationCode} displayed detail amounts differ from the printed total by ${table.roundingDifferenceAmount}; verify whether this is source rounding or OCR.` });
    }
    if (active.some((row) => !row.date && ["INTEREST", "BUSINESS_RECEIPTS", "TCS_206CE", "SAVINGS_INTEREST",
      "TERM_DEPOSIT_INTEREST", "RECURRING_DEPOSIT_INTEREST", "TIME_DEPOSIT_TRANSACTION"].includes(table.category) ||
        !row.period && ["EXC-GSTR3B", "EXC-GSTR1(P)"].includes(table.category))) {
      table.issues.push({ code: "AIS_TABLE_FIELD_UNREADABLE",
        message: `${table.informationCode} has one or more unreadable dates or return periods.` });
    }
    table.status = table.issues.length ? "unverified" :
      printedRounding ? "verified_with_rounding" : "verified";
    issues.push(...table.issues.map((issue) => ({ ...issue, tableId: table.id,
      pageNumber: table.provenance.pageNumber })));
    records.push(...table.rows);
  }
  if (!state.tables.length) issues.push({ code: "AIS_TABLES_NOT_FOUND",
    message: "No structured AIS information tables could be identified." });
  if (state.unclassifiedSections.length) issues.push({ code: "AIS_TABLE_UNCLASSIFIED",
    message: `${state.unclassifiedSections.length} printed AIS information section(s) could not be classified.`,
    sourceRefs: state.unclassifiedSections.map((section) => section.provenance) });
  for (const rejected of state.rejectedRows) issues.push({ code: rejected.reason,
    message: `AIS candidate row at page ${rejected.provenance.pageNumber}, row ${rejected.provenance.rowNumber} could not be normalized.`,
    ...(rejected.tableId ? { tableId: rejected.tableId } : {}), pageNumber: rejected.provenance.pageNumber,
    rowNumber: rejected.provenance.rowNumber });
  return { tables: state.tables, records, issues, warnings,
    unclassifiedSections: state.unclassifiedSections, rejectedRows: state.rejectedRows };
}
