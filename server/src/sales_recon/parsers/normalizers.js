import { auditNormalized } from "./anomalies.js";
import {
  addMoney,
  asNumber,
  cleanText,
  detectDocumentType,
  emptyMoney,
  firstGstin,
  moneyFrom,
  normalizeDate,
  normalizePeriod,
  summarizeRows,
} from "./utils.js";

const FIELD_SYNONYMS = {
  counterpartyGstin: ["ctin", "counterparty gstin", "recipient gstin", "supplier gstin", "vendor gstin", "gstin of recipient"],
  tradeName: ["trdnm", "trade name", "supplier name", "recipient name", "party name", "vendor name"],
  invoiceNumber: ["inum", "invoice number", "invoice no", "invoice", "bill no", "document number"],
  invoiceDate: ["idt", "dt", "invoice date", "bill date", "document date"],
  invoiceValue: ["val", "invoice value", "invoice total", "gross value", "total value"],
  taxableValue: ["txval", "taxable value", "taxable amount", "assessable value"],
  placeOfSupply: ["pos", "place of supply", "state code"],
  reverseCharge: ["rchrg", "rev", "reverse charge", "rcm"],
  igst: ["iamt", "igst", "integrated tax", "igst amount"],
  cgst: ["camt", "cgst", "central tax", "cgst amount"],
  sgst: ["samt", "sgst", "state tax", "utgst", "sgst amount"],
  cess: ["csamt", "cess", "cess amount"],
};

const GENERATED_ANOMALY_CODES = new Set([
  "UNKNOWN_DOCUMENT_TYPE",
  "MISSING_CLIENT_GSTIN",
  "INVALID_CLIENT_GSTIN",
  "MISSING_RETURN_PERIOD",
  "NO_RECORDS",
  "INVALID_COUNTERPARTY_GSTIN",
  "DUPLICATE_INVOICE",
  "INVOICE_TOTAL_INCONSISTENT",
]);

function unwrap(payload) {
  const first = Array.isArray(payload) ? payload[0] : payload;
  return first?.data || first || {};
}

function baseRow(section, category, root, party, document, money, overrides = {}) {
  return {
    section,
    category,
    documentType: overrides.documentType,
    clientGstin: root.gstin || root.ctin || null,
    counterpartyGstin: party.ctin || party.gstin || null,
    tradeName: party.trdnm || party.tradeName || null,
    invoiceNumber: document.inum || document.nt_num || document.invoiceNumber || null,
    invoiceDate: normalizeDate(document.idt || document.dt || document.nt_dt || document.invoiceDate),
    placeOfSupply: cleanText(document.pos || party.pos) || null,
    reverseCharge: document.rchrg || document.rev || null,
    ...money,
    ...overrides,
  };
}

function sumItems(document, sign = 1) {
  const total = moneyFrom(document, sign);
  const items = document.itms || document.items || [];
  if (items.length) {
    const itemTotal = emptyMoney();
    for (const item of items) addMoney(itemTotal, moneyFrom(item.itm_det || item, sign));
    itemTotal.invoiceValue = sign * asNumber(document.val || document.invoiceValue);
    return itemTotal;
  }
  return total;
}

function invoiceGroups(root, key, category, childKey = "inv") {
  const rows = [];
  for (const party of root[key] || []) {
    for (const document of party[childKey] || []) {
      rows.push(baseRow(key, category, root, party, document, sumItems(document), {
        documentType: "gstr1",
        liabilityComponent: category === "taxableOutward" ? "base" : undefined,
      }));
    }
  }
  return rows;
}

function normalizeGstr1(root) {
  const rows = [
    ...invoiceGroups(root, "b2b", "taxableOutward"),
    ...invoiceGroups(root, "b2cl", "taxableOutward"),
    ...invoiceGroups(root, "exp", "zeroRated"),
  ];
  for (const record of root.b2cs || []) {
    rows.push(baseRow("b2cs", "taxableOutward", root, record, record, moneyFrom(record), {
      documentType: "gstr1",
      liabilityComponent: "base",
    }));
  }
  for (const groupName of ["cdnr", "cdnur"]) {
    for (const party of root[groupName] || []) {
      for (const note of party.nt || party.notes || []) {
        const sign = String(note.ntty || note.noteType || "C").toUpperCase().startsWith("C") ? -1 : 1;
        rows.push(baseRow(groupName, "taxableOutward", root, party, note, sumItems(note, sign), {
          documentType: "gstr1",
          liabilityComponent: "adjustment",
        }));
      }
    }
  }
  const nilEntries = root.nil?.inv || root.nil?.nil_inv || (Array.isArray(root.nil) ? root.nil : []);
  for (const entry of nilEntries || []) {
    const nilValue = asNumber(entry.nil_amt) + asNumber(entry.expt_amt);
    if (nilValue) rows.push(baseRow("nil", "nilExempt", root, {}, entry, { ...emptyMoney(), taxableValue: nilValue }, { documentType: "gstr1" }));
    if (asNumber(entry.ngsup_amt)) rows.push(baseRow("nil", "nonGst", root, {}, entry, { ...emptyMoney(), taxableValue: asNumber(entry.ngsup_amt) }, { documentType: "gstr1" }));
  }
  const normalized = finish({
    documentType: "gstr1",
    gstin: cleanText(root.gstin).toUpperCase() || null,
    returnPeriod: normalizePeriod(root.fp || root.rtnprd || root.ret_period),
    rows,
    sourceFields: [],
    sourceRows: [],
    anomalies: [],
  });
  const clientState = normalized.gstin?.slice(0, 2);
  for (const row of rows.filter((item) => ["b2cl", "b2cs"].includes(item.section) && item.placeOfSupply && item.placeOfSupply !== clientState)) {
    addMoney(normalized.summary.interStateUnregistered, row);
  }
  return normalized;
}

function normalizeGstr2b(root) {
  const rows = [];
  for (const party of root.docdata?.b2b || root.b2b || []) {
    for (const invoice of party.inv || []) {
      const category = String(invoice.rev || "N").toUpperCase() === "Y" ? "reverseCharge" : "itcAvailable";
      rows.push(baseRow("b2b", category, root, party, invoice, moneyFrom(invoice), { documentType: "gstr2b", supplierReturnPeriod: party.supprd || null }));
    }
  }
  const normalized = finish({
    documentType: "gstr2b",
    gstin: cleanText(root.gstin).toUpperCase() || null,
    returnPeriod: normalizePeriod(root.rtnprd || root.fp),
    rows,
    sourceFields: [],
    sourceRows: [],
    anomalies: [],
  });
  const availability = root.itcsumm?.itcavl;
  if (availability) {
    normalized.summary.itcAvailable = emptyMoney();
    addMoney(normalized.summary.itcAvailable, moneyFrom(availability.nonrevsup || {}));
  }
  return normalized;
}

function normalizeGstr3b(root) {
  const supply = root.sup_details || root.sup_det || root;
  const definitions = [
    ["osup_det", "3.1(a)", "taxableOutward"],
    ["osup_zero", "3.1(b)", "zeroRated"],
    ["osup_nil_exmp", "3.1(c)", "nilExempt"],
    ["isup_rev", "3.1(d)", "reverseCharge"],
    ["osup_nongst", "3.1(e)", "nonGst"],
  ];
  const rows = [];
  for (const [key, section, category] of definitions) {
    const value = supply[key];
    if (value) rows.push(baseRow(section, category, root, {}, {}, moneyFrom(value), { documentType: "gstr3b" }));
  }
  const itc = root.itc_elg || root.itcElg || {};
  const itcRows = itc.itc_avl || itc.itcAvailable || [];
  if (Array.isArray(itcRows)) {
    for (const entry of itcRows) rows.push(baseRow(`4(A) ${entry.ty || ""}`.trim(), "itcClaimed", root, {}, {}, moneyFrom(entry), { documentType: "gstr3b" }));
  } else if (itcRows && typeof itcRows === "object") {
    rows.push(baseRow("4(A)", "itcClaimed", root, {}, {}, moneyFrom(itcRows), { documentType: "gstr3b" }));
  }
  const interState = root.inter_sup || root.interSup || {};
  for (const entry of interState.unreg_details || interState.unregistered || []) {
    rows.push(baseRow("3.2", "interStateUnregistered", root, {}, entry, moneyFrom(entry), { documentType: "gstr3b", placeOfSupply: cleanText(entry.pos) || null }));
  }
  return finish({
    documentType: "gstr3b",
    gstin: cleanText(root.gstin).toUpperCase() || null,
    returnPeriod: normalizePeriod(root.ret_period || root.rtnprd || root.fp),
    rows,
    sourceFields: [],
    sourceRows: [],
    anomalies: [],
  });
}

function autoFieldMap(fields) {
  const normalized = new Map(fields.map((field) => [String(field).trim().toLowerCase(), field]));
  return Object.fromEntries(Object.entries(FIELD_SYNONYMS).map(([canonical, synonyms]) => {
    const source = synonyms.find((candidate) => normalized.has(candidate));
    return [canonical, source ? normalized.get(source) : ""];
  }));
}

function rowFromSource(source, fieldMap, metadata) {
  const read = (field) => fieldMap[field] ? source[fieldMap[field]] : undefined;
  const money = moneyFrom({
    invoiceValue: read("invoiceValue"), taxableValue: read("taxableValue"),
    igst: read("igst"), cgst: read("cgst"), sgst: read("sgst"), cess: read("cess"),
  });
  return {
    section: "mapped",
    category: metadata.documentType === "gstr2b" ? "itcAvailable" : "taxableOutward",
    documentType: metadata.documentType,
    clientGstin: metadata.gstin,
    counterpartyGstin: cleanText(read("counterpartyGstin")).toUpperCase() || null,
    tradeName: cleanText(read("tradeName")) || null,
    invoiceNumber: cleanText(read("invoiceNumber")) || null,
    invoiceDate: normalizeDate(read("invoiceDate")),
    placeOfSupply: cleanText(read("placeOfSupply")) || null,
    reverseCharge: cleanText(read("reverseCharge")) || null,
    ...money,
  };
}

function finish(normalized) {
  normalized.summary = summarizeRows(normalized.rows);
  normalized.anomalies = auditNormalized(normalized);
  return normalized;
}

export function normalizeJson(payload, filename) {
  const root = unwrap(payload);
  const documentType = detectDocumentType({ filename, payload });
  if (documentType === "gstr1") return normalizeGstr1(root);
  if (documentType === "gstr2b" || documentType === "gstr2") return normalizeGstr2b(root);
  if (documentType === "gstr3b") return normalizeGstr3b(root);
  return genericNormalize([root], filename, { documentType, text: JSON.stringify(root).slice(0, 20000) });
}

export function genericNormalize(sourceRows, filename, hints = {}) {
  const rows = sourceRows.filter((row) => row && typeof row === "object" && !Array.isArray(row));
  const sourceFields = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const text = hints.text || JSON.stringify(rows.slice(0, 20));
  const metadata = {
    documentType: hints.documentType || detectDocumentType({ filename, text }),
    gstin: hints.gstin || firstGstin(text),
    returnPeriod: normalizePeriod(hints.returnPeriod || (filename.match(/(?:0[1-9]|1[0-2])\d{4}/)?.[0])),
  };
  const fieldMap = autoFieldMap(sourceFields);
  const normalizedRows = rows.map((row) => rowFromSource(row, fieldMap, metadata));
  return finish({ ...metadata, rows: normalizedRows, sourceFields, sourceRows: rows, suggestedFieldMap: fieldMap, anomalies: hints.anomalies || [] });
}

export function applyFieldMapping(parsed, input) {
  const metadata = {
    documentType: input.documentType || parsed.documentType,
    gstin: cleanText(input.gstin || parsed.gstin).toUpperCase() || null,
    returnPeriod: normalizePeriod(input.returnPeriod || parsed.returnPeriod),
  };
  if (parsed.builtInSchema) {
    const anomalies = (parsed.anomalies || []).filter((item) => (
      !GENERATED_ANOMALY_CODES.has(item.code)
      && !(item.code === "BOOKS_GSTIN_NOT_FOUND" && metadata.gstin)
    ));
    const rows = parsed.rows.map((row) => ({ ...row, documentType: metadata.documentType, clientGstin: metadata.gstin }));
    return finish({ ...parsed, ...metadata, rows, anomalies });
  }
  if (!parsed.sourceRows?.length) {
    return finish({ ...parsed, ...metadata, anomalies: [] });
  }
  const fieldMap = { ...(parsed.suggestedFieldMap || {}), ...(input.fieldMap || {}) };
  return finish({
    ...parsed,
    ...metadata,
    rows: parsed.sourceRows.map((row) => rowFromSource(row, fieldMap, metadata)),
    suggestedFieldMap: fieldMap,
    anomalies: [],
  });
}
