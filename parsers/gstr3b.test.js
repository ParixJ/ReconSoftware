import assert from "node:assert/strict";
import test from "node:test";
import { parseGstr3bText } from "./gstr3b.js";

test("parses outward supply, ITC and payment tables independently", () => {
  const text = `
    Form GSTR-3B
    Year 2024-25
    Period May
    GSTIN of the supplier 06AANFG4424B1ZR
    2(a). Legal name of the registered person G.G ENTERPRISES
    2(b). Trade name, if any G.G. ENTERPRISES
    2(c). ARN AA060524653470C
    2(d). Date of ARN 20/06/2024
    3.1 Details of Outward supplies and inward supplies liable to reverse charge
    (a) Outward taxable supplies (other than zero rated, nil rated and exempted)
    3121760.00 146972.70 207472.05 207472.05 0.00
    (b) Outward taxable supplies (zero rated) 0.00 0.00 - - 0.00
    (c ) Other outward supplies (nil rated, exempted) 0.00 - - - -
    (d) Inward supplies (liable to reverse charge) 0.00 0.00 0.00 0.00 0.00
    (e) Non-GST outward supplies 0.00 - - - -
    3.2 Out of supplies made in 3.1 (a), details of inter-state supplies made
    Supplies made to Unregistered Persons 0.00 0.00
    Supplies made to Composition Taxable Persons 0.00 0.00
    4. Eligible ITC
    A. ITC Available (whether in full or part)
    (1) Import of goods 0.00 0.00 0.00 0.00
    (2) Import of services 0.00 0.00 0.00 0.00
    (3) Inward supplies liable to reverse charge (other than 1 & 2 above) 0.00 0.00 0.00 0.00
    (4) Inward supplies from ISD 0.00 0.00 0.00 0.00
    (5) All other ITC 490753.80 21852.00 21852.00 0.00
    B. ITC Reversed
    5 Values of exempt, nil-rated and non-GST inward supplies
    6.1 Payment of tax
    Description Total tax payable Tax paid through ITC Tax paid in cash
    Integrated tax Central tax State/UT tax Cess
    (A) Other than reverse charge
    Integrated tax 146973.00 146973.00 0.00 0.00 - 0.00 0.00 -
    Central tax 207472.00 171890.00 21852.00 - - 13730.00 0.00 0.00
    State/UT tax 207472.00 171891.00 - 21852.00 - 13729.00 0.00 0.00
    Cess 0.00 - - - 0.00 0.00 0.00 -
    (B) Reverse charge
    Verification
  `;

  const parsed = parseGstr3bText(text, "gstr-3b-public-record-sample-may-2024.pdf");

  assert.equal(parsed.gstin, "06AANFG4424B1ZR");
  assert.equal(parsed.returnPeriod, "052024");
  assert.equal(parsed.arn, "AA060524653470C");
  assert.deepEqual(
    [parsed.summary.taxableOutward.taxableValue, parsed.summary.taxableOutward.igst, parsed.summary.taxableOutward.cgst, parsed.summary.taxableOutward.sgst],
    [3121760, 146972.7, 207472.05, 207472.05],
  );
  assert.deepEqual(
    [parsed.summary.itcClaimed.igst, parsed.summary.itcClaimed.cgst, parsed.summary.itcClaimed.sgst],
    [490753.8, 21852, 21852],
  );
  assert.deepEqual(
    parsed.payments.slice(0, 3).map((row) => [row.taxPayable, row.paidUsingItc, row.paidInCash]),
    [[146973, 146973, 0], [207472, 193742, 13730], [207472, 193743, 13729]],
  );
  assert.deepEqual(parsed.anomalies, []);
});

test("GSTR-1 outward liability and GSTR-3B table 3.1 can reconcile exactly", async () => {
  const { parseGstr1Text } = await import("./gstr1.js");
  const gstr1 = parseGstr1Text(`
    FORM GSTR-1 GSTIN 29AABFB5678G1Z8 Tax period April 2025
    B2B regular invoices 12 Invoice 860,000.00 45,000.00 54,900.00 54,900.00 0.00
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

  assert.equal(gstr1.gstin, gstr3b.gstin);
  assert.equal(gstr1.returnPeriod, gstr3b.returnPeriod);
  for (const key of ["taxableValue", "igst", "cgst", "sgst", "cess", "totalTax"]) {
    assert.equal(gstr1.summary.taxableOutward[key], gstr3b.summary.taxableOutward[key]);
  }
});
