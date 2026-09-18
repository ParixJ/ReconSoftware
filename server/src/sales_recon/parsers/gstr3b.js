import { EXCEPTION_CODES } from "../../api/errorCodes.js";
import { asNumber } from "./utils.js";
import {
  amountsAfter,
  finalizePdfParse,
  moneyRow,
  namedValue,
  normalizePdfText,
  scannedPdfAnomaly,
  sectionAfter,
} from "./pdfParserUtils.js";

const SUPPLY_ROWS = [
  ["3.1(a)", "taxableOutward", "Outward taxable supplies", /\(a\)\s*Outward\s+taxable\s+supplies/i, /\(b\)\s*Outward\s+taxable/i, [0, 1, 2, 3, 4]],
  ["3.1(b)", "zeroRated", "Zero-rated outward taxable supplies", /\(b\)\s*Outward\s+taxable\s+supplies/i, /\(c\s*\)\s*Other\s+outward/i, [0, 1, undefined, undefined, 2]],
  ["3.1(c)", "nilExempt", "Nil-rated and exempt outward supplies", /\(c\s*\)\s*Other\s+outward\s+supplies/i, /\(d\)\s*Inward\s+supplies/i, [0, undefined, undefined, undefined, undefined]],
  ["3.1(d)", "reverseCharge", "Inward supplies liable to reverse charge", /\(d\)\s*Inward\s+supplies/i, /\(e\)\s*Non-GST/i, [0, 1, 2, 3, 4]],
  ["3.1(e)", "nonGst", "Non-GST outward supplies", /\(e\)\s*Non-GST\s+outward\s+supplies/i, /3\.1\.1|3\.2|FORM\s+GSTR-3B\s*-\s*Eligible/i, [0, undefined, undefined, undefined, undefined]],
];

const ITC_ROWS = [
  ["4(A)(1)", "Import of goods", /(?:A\s*)?\(?1\)?\s*Import\s+of\s+goods/i, /(?:A\s*)?\(?2\)?\s*Import\s+of\s+services/i],
  ["4(A)(2)", "Import of services", /(?:A\s*)?\(?2\)?\s*Import\s+of\s+services/i, /(?:A\s*)?\(?3\)?\s*Inward\s+supplies/i],
  ["4(A)(3)", "Inward supplies liable to reverse charge", /(?:A\s*)?\(?3\)?\s*Inward\s+supplies\s+liable\s+to\s+reverse\s+charge/i, /(?:A\s*)?\(?4\)?\s*Inward\s+supplies\s+from\s+ISD/i],
  ["4(A)(4)", "Inward supplies from ISD", /(?:A\s*)?\(?4\)?\s*Inward\s+supplies\s+from\s+ISD/i, /(?:A\s*)?\(?5\)?\s*All\s+other\s+ITC/i],
  ["4(A)(5)", "All other ITC", /(?:A\s*)?\(?5\)?\s*All\s+other\s+ITC/i, /B\.?\s*ITC\s+Reversed|C\.?\s*Net\s+ITC/i],
];

function parseSupplies(text) {
  const rows = [];
  for (const [section, category, description, start, end, indexes] of SUPPLY_ROWS) {
    const values = amountsAfter(text, start, end, 700);
    if (!values?.length) continue;
    rows.push(moneyRow({ section, category, documentType: "gstr3b", description, values, indexes }));
  }
  return rows;
}

function parseItc(text) {
  const table = sectionAfter(text, /4\.?\s+Eligible\s+ITC/i, /5\.?\s+Values|5\.?\s+Exempt|5\.1\s+Interest|6\.1\s+Payment/i, 6000);
  if (table === null) return [];
  const rows = [];
  for (const [section, description, start, end] of ITC_ROWS) {
    const values = amountsAfter(table, start, end, 500);
    if (!values?.length) continue;
    rows.push(moneyRow({
      section,
      category: "itcClaimed",
      documentType: "gstr3b",
      description,
      values,
      indexes: [undefined, 0, 1, 2, 3],
    }));
  }
  return rows;
}

function parseInterStateUnregistered(text) {
  const table = sectionAfter(text, /3\.2\s+Out\s+of\s+supplies/i, /4\.?\s+Eligible\s+ITC/i, 3000);
  if (table === null) return null;
  const values = amountsAfter(table, /Supplies\s+made\s+to\s+Unregistered\s+Persons/i, /Supplies\s+made\s+to\s+Composition|Supplies\s+made\s+to\s+UIN/i, 500);
  if (!values?.length) return null;
  return moneyRow({
    section: "3.2",
    category: "interStateUnregistered",
    documentType: "gstr3b",
    description: "Inter-state supplies to unregistered persons",
    values,
    indexes: [0, 1, undefined, undefined, undefined],
  });
}

function paymentCellsAfter(text, start, end) {
  const section = sectionAfter(text, start, end, 700);
  if (section === null) return null;
  return [...section.matchAll(/\(?-?\d[\d,]*\.\d{1,2}\)?|(?<!\S)-(?!\S)/g)]
    .map((match) => match[0] === "-" ? 0 : asNumber(match[0]));
}

function parsePaymentRows(text) {
  const table = sectionAfter(text, /6\.1\s+Payment\s+of\s+tax/i, /Breakup\s+of\s+tax\s+liability|Verification/i, 5000);
  if (table === null) return [];
  const portalLayout = /Tax\s+paid\s+through\s+ITC/i.test(table);
  const afterOtherThanReverseCharge = sectionAfter(table, /\(A\)\s*Other\s+than\s+reverse\s+charge/i, /\(B\)\s*Reverse\s+charge/i, 3000) || table;
  const definitions = [
    ["igst", "Integrated tax", /Integrated\s+tax/i, /Central\s+tax/i],
    ["cgst", "Central tax", /Central\s+tax/i, /State\/UT\s+tax/i],
    ["sgst", "State/UT tax", /State\/UT\s+tax/i, /Cess/i],
    ["cess", "Cess", /Cess/i, /\(B\)\s*Reverse\s+charge|Breakup|Verification/i],
  ];
  const payments = [];
  let searchText = afterOtherThanReverseCharge;
  if (portalLayout) {
    const headerEnd = searchText.match(/\(A\)\s*Other\s+than\s+reverse\s+charge/i);
    if (headerEnd) searchText = searchText.slice((headerEnd.index || 0) + headerEnd[0].length);
  }
  for (const [taxHead, description, start, end] of definitions) {
    const values = portalLayout
      ? paymentCellsAfter(searchText, start, end)
      : amountsAfter(searchText, start, end, 700);
    if (!values?.length) continue;
    if (portalLayout) {
      payments.push({
        taxHead,
        description,
        taxPayable: asNumber(values[0]),
        paidUsingItc: asNumber(values[1]) + asNumber(values[2]) + asNumber(values[3]) + asNumber(values[4]),
        paidInCash: asNumber(values[5]),
        interest: asNumber(values[6]),
        lateFee: asNumber(values[7]),
      });
    } else {
      payments.push({
        taxHead,
        description,
        taxPayable: asNumber(values[0]),
        paidUsingItc: asNumber(values[1]),
        paidInCash: asNumber(values[2]),
        interest: asNumber(values[3]),
        lateFee: asNumber(values[4]),
      });
    }
  }
  return payments;
}

export function parseGstr3bText(rawText, filename = "") {
  const text = normalizePdfText(rawText);
  const supplyRows = parseSupplies(text);
  const rows = [...supplyRows, ...parseItc(text)];
  const interState = parseInterStateUnregistered(text);
  if (interState) rows.push(interState);

  const anomalies = scannedPdfAnomaly(text, "gstr3b");
  if (!supplyRows.some((row) => row.section === "3.1(a)") && !anomalies.some((item) => item.code === EXCEPTION_CODES.SCANNED_PDF)) {
    anomalies.push({
      code: EXCEPTION_CODES.GSTR3B_TABLE_3_1_NOT_PARSED,
      severity: "error",
      message: "GSTR-3B was identified, but table 3.1 did not match a supported layout.",
      suggestion: "Upload the GST portal JSON export or review the PDF layout before reconciliation.",
    });
  }

  return finalizePdfParse({
    documentType: "gstr3b",
    text,
    filename,
    rows,
    anomalies,
    metadata: {
      legalName: namedValue(text, /(?:2\(a\)\.\s*)?Legal\s+name(?:\s+of\s+the\s+registered\s+person)?/i, /Trade\s+name|\b2\(b\)/i),
      tradeName: namedValue(text, /(?:2\(b\)\.\s*)?Trade\s+name(?:,\s*if\s+any)?/i, /ARN|Financial\s+year|Fixture\s+status|\b2\(c\)/i),
      arn: namedValue(text, /2\(c\)\.\s*ARN/i, /2\(d\)\.\s*Date\s+of\s+ARN/i),
      arnDate: namedValue(text, /2\(d\)\.\s*Date\s+of\s+ARN/i, /\(Amount\s+in|3\.1\s+Details/i),
    },
    extra: { payments: parsePaymentRows(text) },
  });
}
