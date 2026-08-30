import {
  amountsAfter,
  finalizePdfParse,
  moneyRow,
  namedValue,
  normalizePdfText,
  scannedPdfAnomaly,
} from "./pdfParserUtils.js";

export const GSTR1_PARSER_VERSION = 2;

const SECTION_ORDER = new Map([
  ["4A", 10], ["4B", 20], ["5", 30], ["6A", 40], ["6B", 50], ["6C", 60], ["7", 70],
  ["8-NIL", 80], ["8-EXEMPT", 81], ["8-NONGST", 82],
  ["9A-B2B", 90], ["9A-B2B-RCM", 91], ["9A-B2CL", 92],
  ["9B-CDNR", 100], ["9B-CDNUR", 101], ["10", 110],
]);

const DEFINITIONS = [
  {
    section: "4A",
    category: "taxableOutward",
    description: "B2B regular invoices",
    start: /B2B\s+regular\s+invoices?/i,
    end: /B2B\s+reverse\s+charge|Other\s+outward-supply\s+sections|\b4B\s*-/i,
    indexes: [0, 1, 2, 3, 4],
  },
  {
    section: "4B",
    category: "taxableOutward",
    description: "B2B reverse charge",
    start: /B2B\s+reverse\s+charge/i,
    end: /Other\s+outward-supply\s+sections|\b4C\s*-|\b5\s*-/i,
    indexes: [0, 1, 2, 3, 4],
    reverseCharge: "Y",
  },
  {
    section: "5",
    category: "taxableOutward",
    description: "B2C large",
    start: /(?:\b5\s*\n\s*)?B2C\s+large/i,
    end: /\b6A\b|Exports/i,
    indexes: [0, 1, undefined, undefined, 2],
  },
  {
    section: "6A",
    category: "zeroRated",
    description: "Exports",
    start: /(?:\b6A\s*\n\s*)?Exports/i,
    end: /\b6B\b|SEZ\s+supplies/i,
    indexes: [0, 1, undefined, undefined, 2],
  },
  {
    section: "6B",
    category: "zeroRated",
    description: "SEZ supplies",
    start: /(?:\b6B\s*\n\s*)?SEZ\s+supplies/i,
    end: /\b6C\b|Deemed\s+Exports|\b7\b|B2C\s+others/i,
    indexes: [0, 1, undefined, undefined, 2],
  },
  {
    section: "6C",
    category: "taxableOutward",
    description: "Deemed exports",
    start: /(?:\b6C\s*[-:]?\s*)?Deemed\s+Exports/i,
    end: /\b7\s*-|B2C\s+others/i,
    indexes: [0, 1, 2, 3, 4],
  },
  {
    section: "7",
    category: "taxableOutward",
    description: "B2C others",
    start: /(?:\b7\s*\n\s*)?B2C\s+others/i,
    end: /\b8\b|\b9\b|Amendments|Credit\/Debit/i,
    indexes: [0, 1, 2, 3, 4],
  },
  {
    section: "9",
    category: "taxableOutward",
    description: "Amendments and credit/debit notes",
    start: /Amendments\s+and\s+credit\/debit\s+notes/i,
    end: /FORM\s+GSTR-1\s*-\s*HSN|\b10\s*-/i,
    indexes: [0, 1, 2, 3, 4],
  },
];

function portalSummaryRows(text) {
  const rows = [];
  const portalDefinitions = [
    ["4A", "taxableOutward", "B2B regular invoices", /4A\s*-\s*Taxable\s+outward\s+supplies\s+made\s+to\s+registered\s+persons[\s\S]{0,700}?Total\s*[\d,]+\s*Invoice/i, /\b4B\s*-|\b4C\s*-|\b5A?\s*-/i, [0, 1, 2, 3, 4], 5],
    ["4B", "taxableOutward", "B2B reverse charge", /4B\s*-\s*Taxable\s+outward\s+supplies\s+made\s+to\s+registered\s+persons[\s\S]{0,700}?Total\s*[\d,]+\s*Invoice/i, /\b4C\s*-|\b5A?\s*-/i, [0, 1, 2, 3, 4], 5, "Y"],
    ["5", "taxableOutward", "B2C large", /5A?\s*-\s*Taxable\s+outward\s+inter-state\s+supplies\s+made\s+to\s+unregistered\s+persons[\s\S]{0,700}?Total\s*[\d,]+\s*Invoice/i, /\b6[A-C]?\s*-/i, [0, 1, undefined, undefined, 2], 3],
    ["6A", "zeroRated", "Exports", /6A\s*-\s*(?:Taxable\s+outward\s+supplies\s+made\s+to\s+)?Exports[\s\S]{0,700}?Total\s*[\d,]+\s*Invoice/i, /\b6B\s*-|\b6C\s*-|\b7\s*-/i, [0, 1, undefined, undefined, 2], 3],
    ["6B", "zeroRated", "SEZ supplies", /6B\s*-\s*(?:(?:Taxable\s+outward\s+supplies\s+made\s+to\s+)?SEZ\s+supplies|Supplies\s+made\s+to\s+SEZ\s+unit\s+or\s+SEZ\s+developer)[\s\S]{0,700}?Total\s*[\d,]+\s*Invoice/i, /\b6C\s*-|\b7\s*-/i, [0, 1, undefined, undefined, 2], 3],
    ["6C", "taxableOutward", "Deemed exports", /6C\s*-\s*Deemed\s+Exports[\s\S]{0,700}?Total\s*[\d,]+\s*Invoice/i, /\b7\s*-/i, [0, 1, 2, 3, 4], 5],
    ["7", "taxableOutward", "B2C others", /7\s*-\s*Taxable\s+supplies[\s\S]{0,900}?Total\s*[\d,]+\s*Net\s*Value/i, /\b8\s*-|\b9[A-B]?\s*-/i, [0, 1, 2, 3, 4], 5],
  ];
  for (const [section, category, description, start, end, indexes, minimumAmounts, reverseCharge] of portalDefinitions) {
    const values = amountsAfter(text, start, end, 500);
    if (values?.length >= minimumAmounts) rows.push(moneyRow({
      section,
      category,
      documentType: "gstr1",
      description,
      values,
      indexes,
      extra: { liabilityComponent: category === "taxableOutward" ? "base" : undefined, ...(reverseCharge ? { reverseCharge } : {}) },
    }));
  }

  const adjustments = [
    ["9A-B2B", "B2B regular amendments", /9A\s*-\s*Amendment\s+to\s+taxable\s+outward\s+supplies\s+made\s+to\s+registered\s+person[\s\S]{0,500}?B2B\s+Regular[\s\S]{0,500}?Net\s+differential\s+amount\s*\(Amended\s*-\s*Original\)/i, /B2B\s+Reverse\s+charge|9A\s*-\s*Amendment\s+to\s+Inter-State|\b9B\s*-/i, [0, 1, 2, 3, 4], 5],
    ["9A-B2B-RCM", "B2B reverse-charge amendments", /9A\s*-\s*Amendment\s+to\s+taxable\s+outward\s+supplies\s+made\s+to\s+registered\s+person[\s\S]{0,800}?B2B\s+Reverse\s+charge[\s\S]{0,500}?Net\s+differential\s+amount\s*\(Amended\s*-\s*Original\)/i, /9A\s*-\s*Amendment\s+to\s+Inter-State|\b9B\s*-/i, [0, 1, 2, 3, 4], 5, "Y"],
    ["9A-B2CL", "B2C-large amendments", /9A\s*-\s*Amendment\s+to\s+Inter-State\s+supplies\s+made\s+to\s+unregistered\s+person[\s\S]{0,700}?Net\s+differential\s+amount\s*\(Amended\s*-\s*Original\)/i, /\b9B\s*-|\b10\s*-/i, [0, 1, undefined, undefined, 2], 3],
    ["10", "B2C-other amendments", /10\s*-\s*Amendment\s+to\s+taxable\s+outward\s+supplies\s+made\s+to\s+unregistered\s+person[\s\S]{0,700}?Net\s+differential\s+amount\s*\(Amended\s*-\s*Original\)/i, /\b11\s*-|\b12\s*-|Total\s+Liability/i, [0, 1, 2, 3, 4], 5],
  ];
  for (const [section, description, start, end, indexes, minimumAmounts, reverseCharge] of adjustments) {
    const values = amountsAfter(text, start, end, 600);
    if (!values || values.length < minimumAmounts) continue;
    rows.push(moneyRow({
      section,
      category: "taxableOutward",
      documentType: "gstr1",
      description,
      values,
      indexes,
      extra: { liabilityComponent: "adjustment", ...(reverseCharge ? { reverseCharge } : {}) },
    }));
  }

  const noteGroups = [
    ["9B-CDNR", "Credit/debit notes issued to registered persons", /9B\s*-?\s*Credit\/Debit\s+Notes\s*\(Registered\)[\s\S]{0,1000}?Total\s*-\s*Net\s*off\s*debit\/credit\s*notes\s*\([^)]+\)/i, /9B\s*-?\s*Credit\/Debit\s+Notes\s*\(Unregistered\)|\b9C\s*-|\b10\s*-/i],
    ["9B-CDNUR", "Credit/debit notes issued to unregistered persons", /9B\s*-?\s*Credit\/Debit\s+Notes\s*\(Unregistered\)[\s\S]{0,1000}?Total\s*-\s*Net\s*off\s*debit\/credit\s*notes\s*\([^)]+\)/i, /\b9C\s*-|\b10\s*-/i],
  ];
  for (const [section, description, start, end] of noteGroups) {
    const values = amountsAfter(text, start, end, 500);
    if (values?.length >= 5) rows.push(moneyRow({
      section,
      category: "taxableOutward",
      documentType: "gstr1",
      description,
      values,
      extra: { liabilityComponent: "adjustment" },
    }));
  }
  return rows;
}

function table8Rows(text) {
  const definitions = [
    ["8-NIL", "nilExempt", "Nil-rated outward supplies", /8\s*-\s*Nil\s+rated,?\s*exempted\s+and\s+non\s*GST\s+outward\s+supplies[\s\S]{0,300}?-\s*Nil/i, /-\s*Exempted/i],
    ["8-EXEMPT", "nilExempt", "Exempt outward supplies", /8\s*-\s*Nil\s+rated,?\s*exempted\s+and\s+non\s*GST\s+outward\s+supplies[\s\S]{0,400}?-\s*Exempted/i, /-\s*Non\s*-?\s*GST/i],
    ["8-NONGST", "nonGst", "Non-GST outward supplies", /8\s*-\s*Nil\s+rated,?\s*exempted\s+and\s+non\s*GST\s+outward\s+supplies[\s\S]{0,500}?-\s*Non\s*-?\s*GST/i, /\b9A\s*-/i],
  ];
  return definitions.flatMap(([section, category, description, start, end]) => {
    const values = amountsAfter(text, start, end, 100);
    return values?.length ? [moneyRow({
      section,
      category,
      documentType: "gstr1",
      description,
      values,
      indexes: [0, undefined, undefined, undefined, undefined],
    })] : [];
  });
}

function liabilityFallback(text) {
  const values = amountsAfter(
    text,
    /Total\s+Liability\s*\(Outward\s+supplies\s+other\s+than\s+Reverse\s+charge\)/i,
    /Verification|Authorized\s+Signatory/i,
    500,
  );
  if (!values?.length) return null;
  return moneyRow({
    section: "liability-total",
    category: "taxableOutward",
    documentType: "gstr1",
    description: "Total liability (outward supplies other than reverse charge)",
    values,
  });
}

export function parseGstr1Text(rawText, filename = "") {
  const text = normalizePdfText(rawText);
  const rows = [];
  const syntheticSummaryLayout = /B2B\s+regular\s+invoices?|Other\s+outward-supply\s+sections/i.test(text);
  if (syntheticSummaryLayout) {
    for (const definition of DEFINITIONS) {
      const values = amountsAfter(text, definition.start, definition.end, 1000);
      if (!values?.length) continue;
      rows.push(moneyRow({
        section: definition.section,
        category: definition.category,
        documentType: "gstr1",
        description: definition.description,
        values,
        indexes: definition.indexes,
        extra: {
          liabilityComponent: definition.category === "taxableOutward"
            ? definition.section === "9" ? "adjustment" : "base"
            : undefined,
          ...(definition.reverseCharge ? { reverseCharge: definition.reverseCharge } : {}),
        },
      }));
    }
  }

  if (!syntheticSummaryLayout) rows.push(...portalSummaryRows(text));
  if (!rows.some((row) => String(row.section).startsWith("8-"))) rows.push(...table8Rows(text));
  if (!rows.length) {
    const fallback = liabilityFallback(text);
    if (fallback) rows.push(fallback);
  }
  rows.sort((left, right) => (SECTION_ORDER.get(left.section) ?? 1000) - (SECTION_ORDER.get(right.section) ?? 1000));

  const anomalies = scannedPdfAnomaly(text, "gstr1");
  if (!rows.length && !anomalies.some((item) => item.code === "SCANNED_PDF")) {
    anomalies.push({
      code: "GSTR1_TABLES_NOT_PARSED",
      severity: "error",
      message: "GSTR-1 was identified, but its outward-supply tables did not match a supported layout.",
      suggestion: "Upload the GST portal JSON/XLSX export or review the PDF layout before reconciliation.",
    });
  }

  return finalizePdfParse({
    documentType: "gstr1",
    text,
    filename,
    rows,
    anomalies,
    metadata: {
      legalName: namedValue(text, /(?:2\(a\)\.\s*)?Legal\s+name(?:\s+of\s+the\s+registered\s+person)?/i, /Trade\s+name|Financial\s+year|\b2\(b\)/i),
      tradeName: namedValue(text, /(?:2\(b\)\.\s*)?Trade\s+name(?:,\s*if\s+any)?/i, /Financial\s+year|Fixture\s+status|\b2\(c\)/i),
    },
    extra: { parserVersion: GSTR1_PARSER_VERSION },
  });
}
