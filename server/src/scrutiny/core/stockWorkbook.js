import { normalizeAmount } from "./money.js";

export function toThousandths(value) {
  const match = String(value ?? "").trim().replace(/,/g, "").match(/^([+-]?)(\d+)(?:\.(\d{1,3}))?$/);
  if (!match) throw new Error("Quantity must have at most three fractional digits.");
  const units = BigInt(match[2]) * 1000n + BigInt((match[3] || "").padEnd(3, "0"));
  return match[1] === "-" ? -units : units;
}

export function fromThousandths(value) {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  return `${negative ? "-" : ""}${magnitude / 1000n}.${String(magnitude % 1000n).padStart(3, "0")}`;
}

export function isStockProductWorkbook(rows) {
  return rows.some((row) => /Product Ledger[\s\S]*Product Name/i.test(String(row?.[0] ?? ""))) &&
    rows.some((row) => String(row?.[0] ?? "").trim() === "Bill Date" &&
      String(row?.[3] ?? "").trim() === "Receipt Qty" &&
      String(row?.[5] ?? "").trim() === "Issue Qty");
}

export function normalizeStockWorkbook({ rows, sourceId, originalName, completeExport }) {
  const issues = [];
  const title = rows.find((row) => /Product Ledger[\s\S]*Product Name/i.test(String(row?.[0] ?? "")));
  const product = /Product Name\s*:\s*([^\r\n]+)/i.exec(String(title?.[0] ?? ""))?.[1].trim() || null;
  const period = rows.find((row) => /^From Date\s+\d{2}\/\d{2}\/\d{4}/i.test(String(row?.[0] ?? "")));
  const from = /From Date\s+(\d{2})\/(\d{2})\/(\d{4})\s+To/i.exec(String(period?.[0] ?? ""));
  const year = from ? Number(from[3]) - (Number(from[2]) < 4 ? 1 : 0) : null;
  const header = rows.findIndex((row) => String(row?.[0] ?? "").trim() === "Bill Date" &&
    String(row?.[3] ?? "").trim() === "Receipt Qty");
  const records = [];
  const provenance = (index) => ({ sourceId, originalName, sheet: "Sheet1", rowNumber: index + 1 });
  for (let index = header + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const label = String(row?.[0] ?? "").trim();
    const movementDate = row?.[0] instanceof Date ? row[0].toISOString().slice(0, 10) :
      /^\d{4}-\d{2}-\d{2}/.test(label) ? label.slice(0, 10) : null;
    if (!label) continue;
    try {
      if (label === "Op. Stock") {
        records.push({ kind: "opening", product, quantity: fromThousandths(toThousandths(row[3])),
          value: normalizeAmount(row[4]), provenance: provenance(index) });
      } else if (/^Total\s*\r?\nCl\.Stock$/i.test(label)) {
        const [receiptTotal, closing] = String(row[3] ?? "").split(/\r?\n/);
        records.push({ kind: "closing", product,
          receiptTotal: fromThousandths(toThousandths(receiptTotal)),
          issueTotal: fromThousandths(toThousandths(row[5])),
          quantity: fromThousandths(toThousandths(closing)), provenance: provenance(index) });
      } else if (movementDate) {
        const receipt = row[3] == null || row[3] === "" ? 0n : toThousandths(row[3]);
        const issue = row[5] == null || row[5] === "" ? 0n : toThousandths(row[5]);
        if (receipt < 0n || issue < 0n || (receipt === 0n && issue === 0n)) throw new Error("Movement quantity is invalid.");
        records.push({ kind: "movement", product, date: movementDate,
          voucherType: String(row[1] ?? "").trim(), voucherId: String(row[2] ?? "").trim() || null,
          receiptQuantity: fromThousandths(receipt), issueQuantity: fromThousandths(issue),
          provenance: provenance(index) });
      } else {
        issues.push({ code: "AUDIT_STOCK_ROW_UNREADABLE", rowNumber: index + 1,
          message: "A nonempty product-ledger row was not recognized as a movement or control total." });
      }
    } catch (error) {
      issues.push({ code: "INVALID_AUDIT_ROW", rowNumber: index + 1, message: error.message });
    }
  }
  if (!product || !year || records.filter((record) => record.kind === "opening").length !== 1 ||
      records.filter((record) => record.kind === "closing").length !== 1) {
    issues.push({ code: "AUDIT_STOCK_LAYOUT_INCOMPLETE",
      message: "The product, period, opening, or closing row could not be identified uniquely." });
  }
  if (completeExport !== true) issues.push({ code: "AUDIT_EXPORT_COMPLETENESS_UNCONFIRMED",
    message: "Export completeness has not been confirmed." });
  return { sourceId, role: "supporting_document", originalName, format: "xlsx",
    documentType: "stock_product_ledger", financialYear: year ? `${year}-${year + 1}` : null,
    taxpayerId: null, completeExport: completeExport === true,
    parseWarnings: ["This product ledger has no PAN/GSTIN; confirm it belongs to the audit taxpayer."],
    status: issues.length ? "insufficient_data" : "ready", recordCount: records.length, records, issues };
}
