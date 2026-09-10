import { GSTIN_PATTERN, asNumber } from "./utils.js";

function anomaly(code, severity, message, suggestion, rowIndex) {
  return { code, severity, message, suggestion, ...(Number.isInteger(rowIndex) ? { rowIndex } : {}) };
}

export function auditNormalized(normalized) {
  const anomalies = [...(normalized.anomalies || [])];
  if (normalized.documentType === "unknown") {
    anomalies.push(anomaly("UNKNOWN_DOCUMENT_TYPE", "error", "The GST return type could not be identified.", "Open Modify mapping and choose the return type."));
  }
  if (!normalized.gstin) {
    anomalies.push(anomaly("MISSING_CLIENT_GSTIN", "error", "Client GSTIN was not found in the document.", "Open Modify mapping and enter the client GSTIN."));
  } else if (!new RegExp(`^${GSTIN_PATTERN.source.replace(/^\\b|\\b$/g, "")}$`, "i").test(normalized.gstin)) {
    anomalies.push(anomaly("INVALID_CLIENT_GSTIN", "error", `Client GSTIN ${normalized.gstin} is not in the expected 15-character format.`, "Verify the source or correct the GSTIN in Modify mapping."));
  }
  if (!normalized.returnPeriod) {
    anomalies.push(anomaly("MISSING_RETURN_PERIOD", "error", "Return period was not found in the document.", "Open Modify mapping and enter the period as MMYYYY."));
  }
  if (!normalized.rows.length) {
    anomalies.push(anomaly("NO_RECORDS", "warning", "No structured records were extracted.", "Check whether the return is empty or map the source columns manually."));
  }

  const invoiceKeys = new Map();
  normalized.rows.forEach((row, index) => {
    if (row.counterpartyGstin && !GSTIN_PATTERN.test(String(row.counterpartyGstin).toUpperCase())) {
      anomalies.push(anomaly("INVALID_COUNTERPARTY_GSTIN", "error", `Row ${index + 1} has an invalid counterparty GSTIN.`, "Verify the supplier/recipient GSTIN in the source.", index));
    }
    if (row.invoiceNumber) {
      const key = `${row.counterpartyGstin || ""}|${String(row.invoiceNumber).toUpperCase()}`;
      if (invoiceKeys.has(key)) {
        anomalies.push(anomaly("DUPLICATE_INVOICE", "warning", `Invoice ${row.invoiceNumber} appears more than once for the same counterparty.`, "Review amendments and duplicate uploads before relying on totals.", index));
      } else invoiceKeys.set(key, index);
    }
    const componentTotal = asNumber(row.taxableValue) + asNumber(row.totalTax);
    const isReverseCharge = ["Y", "YES", "TRUE"].includes(String(row.reverseCharge || "").toUpperCase());
    if (!isReverseCharge && asNumber(row.invoiceValue) > 0 && componentTotal - asNumber(row.invoiceValue) > 1) {
      anomalies.push(anomaly("INVOICE_TOTAL_INCONSISTENT", "warning", `Invoice ${row.invoiceNumber || index + 1} is lower than taxable value plus tax.`, "Check mapped amount columns and rounding in the source.", index));
    }
  });
  return anomalies;
}
