import assert from "node:assert/strict";
import test from "node:test";
import { parseGstr1Text } from "./gstr1.js";
import { parseGstr3bText } from "./gstr3b.js";
import { parseSalesRegisterMatrix, SalesRegisterParseError } from "./salesRegister.js";

const headers = [
  "Bill Date", "Bill No", "C/D", "Party Name", "Party GSTIN No",
  "Assessable Amount", "Central Tax-9.00%", "State/UT Tax-9.00%",
  "Integrated Tax-18.00%", "Nil Rated Assessable Amount", "Bill Amount",
];

test("detects a non-first-row sales-register header and groups signed books totals", () => {
  const parsed = parseSalesRegisterMatrix([
    ["DEMO COMPANY", "GSTIN 27AABCM1234F1ZX"],
    ["Sales Register"],
    headers,
    [new Date(2025, 3, 3), "INV-1", "Debit", "Registered buyer", "29AABFB5678G1Z8", 100000, 9000, 9000, 0, 0, 118000],
    ["05/04/2025", "INV-2", "Debit", "Retail buyer", "", 50000, 0, 0, 9000, 0, 59000],
    ["07/04/2025", "CN-1", "Credit", "Registered buyer", "29AABFB5678G1Z8", 10000, 900, 900, 0, 0, 11800],
    ["02/05/2025", "INV-3", "Debit", "Registered buyer", "29AABFB5678G1Z8", 25000, 2250, 2250, 0, 500, 29500],
  ], "sales-register.xlsx");

  assert.equal(parsed.documentType, "salesRegister");
  assert.equal(parsed.gstin, "27AABCM1234F1ZX");
  assert.equal(parsed.headerRowNumber, 3);
  assert.ok(parsed.rows.every((row) => row.clientGstin === "27AABCM1234F1ZX"));
  assert.equal(parsed.recordCount, 4);
  assert.equal(parsed.periodCount, 2);
  assert.equal(parsed.returnPeriod, null);
  assert.deepEqual(
    [parsed.periods["042025"].net.taxableValue, parsed.periods["042025"].net.igst, parsed.periods["042025"].net.cgst, parsed.periods["042025"].net.sgst],
    [140000, 9000, 8100, 8100],
  );
  assert.equal(parsed.periods["042025"].b2b.taxableValue, 90000);
  assert.equal(parsed.periods["042025"].b2c.taxableValue, 50000);
  assert.equal(parsed.periods["042025"].creditDebitNotes.taxableValue, -10000);
  assert.equal(parsed.periods["052025"].nilExemptValue, 500);
});

test("reconciles matched books, GSTR-1 and GSTR-3B control totals", () => {
  const books = parseSalesRegisterMatrix([
    ["DEMO COMPANY", "GSTIN 29AABFB5678G1Z8"],
    headers,
    [new Date(2025, 3, 30), "INV-1", "Debit", "Registered buyer", "27AABCM1234F1ZX", 860000, 54900, 54900, 45000, 0, 1014800],
  ], "matched-sales-register.xlsx");
  const gstr1 = parseGstr1Text(`
    FORM GSTR-1 GSTIN 29AABFB5678G1Z8 Tax period April 2025
    B2B regular invoices 1 Invoice 860,000.00 45,000.00 54,900.00 54,900.00 0.00
    B2B reverse charge 0 Invoice 0.00 0.00 0.00 0.00 0.00
    Other outward-supply sections
  `, "gstr-1-apr-2025.pdf");
  const gstr3b = parseGstr3bText(`
    FORM GSTR-3B GSTIN 29AABFB5678G1Z8 Period April 2025
    (a) Outward taxable supplies other than zero/nil/exempt 860,000.00 45,000.00 54,900.00 54,900.00 0.00
    (b) Outward taxable supplies - zero rated 0.00 0.00 - - 0.00
    (c) Other outward supplies - nil rated/exempt 0.00 - - - -
    (d) Inward supplies liable to reverse charge 0.00 0.00 0.00 0.00 0.00
    (e) Non-GST outward supplies 0.00 - - - -
  `, "gstr-3b-apr-2025.pdf");

  const values = [books.periods["042025"].net, gstr1.summary.taxableOutward, gstr3b.summary.taxableOutward];
  for (const key of ["taxableValue", "igst", "cgst", "sgst", "cess", "totalTax"]) {
    assert.equal(values[0][key], values[1][key]);
    assert.equal(values[1][key], values[2][key]);
  }
});

test("returns null for an unrelated workbook in non-strict production detection", () => {
  assert.equal(parseSalesRegisterMatrix([["Name", "Value"], ["A", 1]], "other.xlsx", { strict: false }), null);
});

test("reports missing required sales-register columns in strict mode", () => {
  assert.throws(
    () => parseSalesRegisterMatrix([["Name", "Value"], ["A", 1]], "bad.xlsx"),
    (error) => error instanceof SalesRegisterParseError && error.code === "SALES_REGISTER_HEADER_NOT_FOUND",
  );
});
