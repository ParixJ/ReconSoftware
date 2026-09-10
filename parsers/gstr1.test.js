import assert from "node:assert/strict";
import test from "node:test";
import { parseGstr1Text } from "./gstr1.js";

test("parses the synthetic GSTR-1 summary layout", () => {
  const text = `
    FORM GSTR-1
    GSTIN
    27AABCM1234F1ZX
    Legal name
    MERIDIAN TEST SUPPLIES PRIVATE LIMITED
    Trade name
    Meridian Test Supplies
    Financial year / tax period
    2025-26 / April 2025
    4A - Taxable outward supplies made to registered persons
    B2B regular invoices
    12
    Invoice
    1,250,000.00
    90,000.00
    67,500.00
    67,500.00
    0.00
    B2B reverse charge
    0
    Invoice
    0.00
    0.00
    0.00
    0.00
    0.00
    Other outward-supply sections
    5
    B2C large
    0
    0.00
    0.00
    -
    -
    0.00
    6A
    Exports
    0
    0.00
    0.00
    -
    -
    0.00
    6B
    SEZ supplies
    0
    0.00
    0.00
    -
    -
    0.00
    7
    B2C others
    0
    0.00
    0.00
    0.00
    0.00
    0.00
    9
    Amendments and credit/debit notes
    0
    0.00
    0.00
    0.00
    0.00
    0.00
  `;

  const parsed = parseGstr1Text(text, "gstr-1-apr-2025-synthetic.pdf");

  assert.equal(parsed.gstin, "27AABCM1234F1ZX");
  assert.equal(parsed.returnPeriod, "042025");
  assert.equal(parsed.legalName, "MERIDIAN TEST SUPPLIES PRIVATE LIMITED");
  assert.equal(parsed.tradeName, "Meridian Test Supplies");
  assert.equal(parsed.rows.length, 7);
  assert.deepEqual(
    [parsed.summary.taxableOutward.taxableValue, parsed.summary.taxableOutward.igst, parsed.summary.taxableOutward.cgst, parsed.summary.taxableOutward.sgst],
    [1250000, 90000, 67500, 67500],
  );
  assert.deepEqual(parsed.anomalies, []);
});

test("does not represent a scanned GSTR-1 as a successful zero return", () => {
  const parsed = parseGstr1Text("90\n4638\n91\n4639", "gstr-1-public-record-sample-mar-2025.pdf");

  assert.equal(parsed.returnPeriod, "032025");
  assert.equal(parsed.rows.length, 0);
  assert.ok(parsed.anomalies.some((item) => item.code === "SCANNED_PDF" && item.severity === "error"));
});

test("parses GST portal summary rows without confusing section headings for values", () => {
  const parsed = parseGstr1Text(`
    FORM GSTR-1 GSTIN 27AABCM1234F1ZX Tax period April 2025
    4A - Taxable outward supplies made to registered persons
    Total 2 Invoice 100,000.00 18,000.00 0.00 0.00 0.00
    5 - Taxable outward inter-state supplies made to unregistered persons
    Total 1 Invoice 50,000.00 9,000.00 0.00
    6A - Exports
    7 - Taxable supplies
    Total 1 Net Value 25,000.00 0.00 2,250.00 2,250.00 0.00
    8 - Nil rated supplies
  `, "gstr1-apr-2025.pdf");

  assert.deepEqual(parsed.rows.map((row) => row.section), ["4A", "5", "7"]);
  assert.deepEqual(
    [parsed.summary.taxableOutward.taxableValue, parsed.summary.taxableOutward.igst, parsed.summary.taxableOutward.cgst, parsed.summary.taxableOutward.sgst],
    [175000, 27000, 2250, 2250],
  );
});
