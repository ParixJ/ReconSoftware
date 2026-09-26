const INTERNAL_FIELDS = new Set([
  "provenance", "sourceRefs", "sourceId", "originalName", "rawText", "rawAmount",
  "text", "cells", "alternateCells", "confidence", "identityCandidates", "issues",
  "parseWarnings", "entries", "tableId", "rowNumber", "columnNumber", "pageNumber",
]);

const FIELD_LABELS = Object.freeze({
  entityName: "Client / entity",
  taxpayerId: "PAN / GSTIN",
  financialYear: "Financial year",
  ledger: "Ledger account",
  accountRole: "Account classification",
  openingBalance: "Opening balance",
  closingBalance: "Closing balance",
  openingDebit: "Opening debit",
  openingCredit: "Opening credit",
  closingDebit: "Closing debit",
  closingCredit: "Closing credit",
  debits: "Total debits",
  credits: "Total credits",
  debitAmount: "Debit",
  creditAmount: "Credit",
  amount: "Amount",
  expectedAmount: "Expected amount",
  actualAmount: "Actual amount",
  differenceAmount: "Difference",
  bookAmount: "Amount as per books",
  supportAmount: "Amount as per supporting document",
  reportAmount: "Amount as per report",
  taxableValue: "Taxable value",
  incomeAmount: "Income amount",
  taxDeducted: "Tax deducted",
  taxAmount: "Tax amount",
  openingWdv: "Opening WDV",
  closingWdv: "Closing WDV",
  additionsMoreThan180Days: "Additions held over 180 days",
  additionsLessThan180Days: "Additions held up to 180 days",
  deductions: "Deductions / disposals",
  depreciation: "Depreciation",
  date: "Date",
  period: "Period",
  voucherId: "Voucher number",
  voucherType: "Voucher type",
  billReference: "Bill reference",
  reference: "Reference",
  counterparty: "Party / client",
  party: "Party / client",
  supplier: "Supplier",
  lender: "Lender",
  narration: "Narration",
  particulars: "Particulars",
  description: "Description",
  query: "Scrutiny query",
  queryType: "Query type",
  asset: "Asset",
  balanceSide: "Balance side",
  category: "Category",
  section: "Section",
  informationCode: "Information code",
  taxHead: "Tax head",
  account: "Tax account",
  kind: "Record type",
  side: "Entry side",
  comparison: "Comparison",
  status: "Status",
  count: "Count",
  transactionCount: "Transactions",
  rate: "Rate",
  ratePercent: "Rate (%)",
  quantity: "Quantity",
  closingQuantity: "Closing quantity",
  daysSinceLastMovement: "Days since last movement",
});

const MONEY_FIELD = /(?:amount|balance|debits?|credits?|turnover|taxable|tax deducted|wdv|depreciation|additions?|deductions?|repayments?|interest|value)$/i;
const NON_MONEY_FIELD = /(?:count|quantity|rate|percent|days|year|number|date|period)$/i;

export function humanizeFinancialField(field) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  return String(field || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function isFinancialAmountField(field) {
  const label = humanizeFinancialField(field);
  return /Amount$/.test(String(field)) || MONEY_FIELD.test(label) && !NON_MONEY_FIELD.test(label);
}

export function formatFinancialValue(field, value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    const scalar = value.filter((item) => ["string", "number", "boolean"].includes(typeof item));
    return scalar.length === value.length ? scalar.join("; ") : `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  if (typeof value === "object") return "Available in supporting detail";
  if (isFinancialAmountField(field) && /^-?\d+(?:\.\d+)?$/.test(String(value).trim())) {
    const amount = Number(value);
    if (Number.isFinite(amount)) return new Intl.NumberFormat("en-IN", {
      style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(amount);
  }
  return String(value).replaceAll("_", " ");
}

function addTaxHeads(output, taxHeads) {
  if (!taxHeads || typeof taxHeads !== "object" || Array.isArray(taxHeads)) return;
  for (const [head, value] of Object.entries(taxHeads)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [measure, amount] of Object.entries(value)) output[`${head} ${measure}`] = amount;
    } else output[`${head} amount`] = value;
  }
}

export function financialRecord(record) {
  const output = {};
  if (!record || typeof record !== "object" || Array.isArray(record)) return output;
  for (const [field, value] of Object.entries(record)) {
    if (INTERNAL_FIELDS.has(field) || value === undefined || value === null || field === "taxHeads") continue;
    if (field === "details") {
      if (Array.isArray(value) && value.length) output.particulars = value.join(" · ");
      continue;
    }
    if (typeof value === "object" && !Array.isArray(value)) continue;
    if (Array.isArray(value) && value.some((item) => item && typeof item === "object")) continue;
    output[field] = value;
  }
  addTaxHeads(output, record.taxHeads);
  if (record.amount !== undefined && record.side === "debit") {
    output.debitAmount = record.amount;
    delete output.amount;
  } else if (record.amount !== undefined && record.side === "credit") {
    output.creditAmount = record.amount;
    delete output.amount;
  }
  return output;
}

const PREFERRED_FIELDS = [
  "entityName", "ledger", "accountRole", "date", "period", "voucherId", "voucherType",
  "counterparty", "party", "supplier", "reference", "billReference", "particulars", "narration",
  "openingBalance", "openingDebit", "openingCredit", "debits", "credits", "debitAmount", "creditAmount",
  "closingBalance", "closingDebit", "closingCredit", "amount", "taxableValue", "incomeAmount",
  "bookAmount", "supportAmount", "reportAmount", "expectedAmount", "actualAmount", "differenceAmount",
  "section", "informationCode", "category", "query", "asset", "openingWdv", "additionsMoreThan180Days",
  "additionsLessThan180Days", "deductions", "depreciation", "closingWdv", "status", "comparison",
];

export function financialTable(records) {
  const normalized = (records || []).map(financialRecord).filter((record) => Object.keys(record).length);
  const available = [...new Set(normalized.flatMap((record) => Object.keys(record)))];
  const fields = [
    ...PREFERRED_FIELDS.filter((field) => available.includes(field)),
    ...available.filter((field) => !PREFERRED_FIELDS.includes(field)),
  ];
  const labels = Object.fromEntries(fields.map((field) => [field, humanizeFinancialField(field)]));
  const rows = normalized.map((record) => Object.fromEntries(fields.map((field) => [
    labels[field], formatFinancialValue(field, record[field]),
  ])));
  return { fields: fields.map((field) => labels[field]), rows };
}

export function ledgerSummaryTable(records) {
  return financialTable((records || []).map((record) => ({
    entityName: record.entityName,
    ledger: record.ledger,
    accountRole: record.accountRole,
    openingBalance: record.openingBalance,
    debits: record.debits,
    credits: record.credits,
    closingBalance: record.closingBalance,
    transactionCount: Array.isArray(record.entries) ? record.entries.length : 0,
  })));
}

export function ledgerTransactionTable(record) {
  return financialTable((record?.entries || []).map((entry) => ({
    date: entry.date,
    voucherId: entry.voucherId,
    voucherType: entry.voucherType,
    counterparty: entry.counterparty,
    billReference: entry.billReference,
    details: entry.details,
    side: entry.side,
    amount: entry.amount,
  })));
}

export function evidenceFacts(item) {
  if (!item || typeof item !== "object") return [];
  const facts = [];
  for (const [field, value] of Object.entries(item)) {
    if (INTERNAL_FIELDS.has(field) || field === "issues" || value === null || value === undefined || value === "") continue;
    if (typeof value === "object" && !Array.isArray(value)) continue;
    if (Array.isArray(value) && value.some((entry) => entry && typeof entry === "object")) continue;
    facts.push({ field, label: humanizeFinancialField(field), value: formatFinancialValue(field, value) });
  }
  return facts;
}

export function evidenceIssues(item) {
  return Array.isArray(item?.issues) ? item.issues.map((issue) => issue?.message || issue?.code).filter(Boolean) : [];
}
