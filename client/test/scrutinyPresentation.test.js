import assert from "node:assert/strict";
import test from "node:test";
import {
  evidenceFacts,
  financialTable,
  ledgerSummaryTable,
  ledgerTransactionTable,
} from "../src/api/scrutinyPresentation.js";

test("ledger presentation exposes financial summaries and transaction detail without parser internals", () => {
  const ledger = {
    entityName: "Example Client",
    ledger: "Professional Fees",
    openingBalance: "100.00",
    debits: "27000.00",
    credits: "0.00",
    closingBalance: "27100.00",
    provenance: { sourceId: "source-1", rowNumber: 8 },
    entries: [{ date: "2025-04-30", voucherId: "PV-1", counterparty: "Advisor",
      side: "debit", amount: "27000.00", details: ["Consultancy invoice"],
      provenance: { sourceId: "source-1", rowNumber: 9 } }],
  };
  const summary = ledgerSummaryTable([ledger]);
  assert.deepEqual(summary.fields, ["Client / entity", "Ledger account", "Opening balance",
    "Total debits", "Total credits", "Closing balance", "Transactions"]);
  assert.equal(summary.rows[0]["Total debits"], "₹27,000.00");
  assert.equal(Object.hasOwn(summary.rows[0], "Provenance"), false);

  const transactions = ledgerTransactionTable(ledger);
  assert.equal(transactions.rows[0]["Party / client"], "Advisor");
  assert.equal(transactions.rows[0].Debit, "₹27,000.00");
  assert.equal(transactions.rows[0].Particulars, "Consultancy invoice");
  assert.equal(Object.hasOwn(transactions.rows[0], "Provenance"), false);
});

test("financial tables flatten tax heads and hide nested extraction objects", () => {
  const table = financialTable([{ date: "2025-05-01", reference: "GST-1",
    taxHeads: { integrated: "100.00", central: "50.00" },
    provenance: { sourceId: "gst", pageNumber: 2 }, rawText: "internal OCR text" }]);
  assert.equal(table.rows[0]["Integrated Amount"], "₹100.00");
  assert.equal(table.rows[0]["Central Amount"], "₹50.00");
  assert.equal(Object.hasOwn(table.rows[0], "Raw Text"), false);
});

test("scrutiny evidence is rendered as labelled financial facts without source coordinates", () => {
  const facts = evidenceFacts({ label: "Depreciation expense", expectedAmount: "38453.00",
    actualAmount: "38453.23", differenceAmount: "0.23",
    sourceRefs: [{ sourceId: "books", rowNumber: 100 }],
    provenance: { sourceId: "manual", rowNumber: 33 } });
  assert.deepEqual(facts.map(({ label }) => label), ["Label", "Expected amount", "Actual amount", "Difference"]);
  assert.equal(facts.find(({ label }) => label === "Difference").value, "₹0.23");
});

