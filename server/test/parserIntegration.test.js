import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseGstr1Text } from "../src/parsers/gstr1.js";
import { parseGstr3bText } from "../src/parsers/gstr3b.js";
import { parseUploadedFile } from "../src/parsers/index.js";
import { applyFieldMapping } from "../src/parsers/normalizers.js";
import { parseSalesRegisterMatrix } from "../src/parsers/salesRegister.js";

test("routes an uploaded PDF through the detected GSTR-1 parser", async () => {
  const testPdf = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../node_modules/pdf-parse/test/data/04-valid.pdf");
  const parsed = await parseUploadedFile(testPdf, "gstr-1-layout.pdf", "application/pdf");
  assert.equal(parsed.fileType, "pdf");
  assert.equal(parsed.documentType, "gstr1");
  assert.ok(parsed.anomalies.some((item) => item.code === "GSTR1_TABLES_NOT_PARSED"));
});

test("parses GSTR-1 PDF text into outward-liability control totals", () => {
  const parsed = parseGstr1Text(`
    FORM GSTR-1 GSTIN 29AABFB5678G1Z8 Tax period April 2025
    B2B regular invoices 12 Invoice 860,000.00 45,000.00 54,900.00 54,900.00 0.00
    B2B reverse charge 0 Invoice 0.00 0.00 0.00 0.00 0.00
    Other outward-supply sections
  `, "gstr-1-apr-2025.pdf");

  assert.equal(parsed.documentType, "gstr1");
  assert.equal(parsed.returnPeriod, "042025");
  assert.equal(parsed.builtInSchema, true);
  assert.deepEqual(
    [parsed.summary.taxableOutward.taxableValue, parsed.summary.taxableOutward.igst, parsed.summary.taxableOutward.cgst, parsed.summary.taxableOutward.sgst],
    [860000, 45000, 54900, 54900],
  );
  assert.deepEqual(parsed.anomalies, []);
});

test("parses collapsed GST portal cells instead of reporting a zero GSTR-1 taxable total", () => {
  const parsed = parseGstr1Text(`
    FORM GSTR-1 Financial year2022-23 Tax periodDecember GSTIN 29AABFB5678G1Z8
    4A - Taxable outward supplies made to registered persons (other than reverse charge supplies) - B2B Regular
    Total42Invoice68,02,167.001,76,222.0081,946.0081,946.000.00
    4B - Taxable outward supplies made to registered persons attracting tax on reverse charge - B2B Reverse charge
    Total0Invoice0.000.000.000.000.00
    5A - Taxable outward inter-state supplies made to unregistered persons (where invoice value is more than Rs.2.5 lakh) - B2CL (Large)
    Total0Invoice0.000.000.00
    6A - Exports (with/without payment)
    Total0Invoice0.000.000.00
    6B - Supplies made to SEZ unit or SEZ developer - SEZWP/SEZWOP
    Total0Invoice0.000.000.00
    6C - Deemed Exports - DE
    Total0Invoice0.000.000.000.000.00
    7 - Taxable supplies (Net of debit and credit notes) to unregistered persons (other than the supplies covered in Table 5) - B2CS (Others)
    Total0Net Value0.000.000.000.000.00
    8 - Nil rated, exempted and non GST outward supplies
    Total3,000.00
    - Nil1,000.00
    - Exempted500.00
    - Non-GST1,500.00
    9B - Credit/Debit Notes (Registered) – CDNR
    Total - Net off debit/credit notes (Debit notes - Credit notes)1Note-20,900.000.00-1,881.00-1,881.000.00
    9B - Credit/Debit Notes (Unregistered) – CDNUR
    Total - Net off debit/credit notes (Debit notes - Credit notes)0Note0.000.000.00
    10 - Amendment to taxable outward supplies made to unregistered person
  `, "gstr1-dec-2022.pdf");

  assert.equal(parsed.returnPeriod, "122022");
  assert.equal(parsed.rows.find((row) => row.section === "4A")?.taxableValue, 6802167);
  assert.ok(parsed.rows.some((row) => row.section === "6B"));
  assert.equal(parsed.rows.find((row) => row.section === "8-NIL")?.taxableValue, 1000);
  assert.equal(parsed.rows.find((row) => row.section === "8-EXEMPT")?.taxableValue, 500);
  assert.equal(parsed.rows.find((row) => row.section === "8-NONGST")?.taxableValue, 1500);
  assert.deepEqual(
    [parsed.summary.taxableOutward.taxableValue, parsed.summary.taxableOutward.igst, parsed.summary.taxableOutward.cgst, parsed.summary.taxableOutward.sgst],
    [6781267, 176222, 80065, 80065],
  );
  assert.equal(parsed.summary.taxableOutwardBase.taxableValue, 6802167);
  assert.equal(parsed.summary.taxableOutwardAdjustments.taxableValue, -20900);
  assert.equal(parsed.summary.nilExempt.taxableValue, 1500);
  assert.equal(parsed.summary.nonGst.taxableValue, 1500);
});

test("recognizes the GST portal 5A label when B2C-large is the only taxable section", () => {
  const parsed = parseGstr1Text(`
    FORM GSTR-1 GSTIN 29AABFB5678G1Z8 Tax period April 2025
    4A - Taxable outward supplies made to registered persons
    Total0Invoice0.000.000.000.000.00
    4B - Taxable outward supplies made to registered persons attracting tax on reverse charge
    Total0Invoice0.000.000.000.000.00
    5A - Taxable outward inter-state supplies made to unregistered persons
    Total2Invoice2,50,000.0045,000.000.00
    6A - Exports
  `, "gstr1-apr-2025.pdf");

  assert.equal(parsed.rows.find((row) => row.section === "5")?.taxableValue, 250000);
  assert.equal(parsed.summary.taxableOutward.taxableValue, 250000);
});

test("flags a GSTR-1 PDF without a usable text layer", () => {
  const parsed = parseGstr1Text("90\n4638\n91\n4639", "gstr-1-public-record-sample-mar-2025.pdf");
  assert.equal(parsed.rows.length, 0);
  assert.ok(parsed.anomalies.some((item) => item.code === "SCANNED_PDF" && item.severity === "error"));
});

test("parses GSTR-3B PDF text into table 3.1 and ITC totals", () => {
  const parsed = parseGstr3bText(`
    Form GSTR-3B Period May 2024 GSTIN of the supplier 06AANFG4424B1ZR
    3.1 Details of Outward supplies and inward supplies liable to reverse charge
    (a) Outward taxable supplies (other than zero rated, nil rated and exempted) 3121760.00 146972.70 207472.05 207472.05 0.00
    (b) Outward taxable supplies (zero rated) 0.00 0.00 - - 0.00
    (c) Other outward supplies (nil rated, exempted) 0.00 - - - -
    (d) Inward supplies (liable to reverse charge) 0.00 0.00 0.00 0.00 0.00
    (e) Non-GST outward supplies 0.00 - - - -
    4. Eligible ITC
    A. ITC Available (whether in full or part)
    (1) Import of goods 0.00 0.00 0.00 0.00
    (2) Import of services 0.00 0.00 0.00 0.00
    (3) Inward supplies liable to reverse charge (other than 1 & 2 above) 0.00 0.00 0.00 0.00
    (4) Inward supplies from ISD 0.00 0.00 0.00 0.00
    (5) All other ITC 490753.80 21852.00 21852.00 0.00
    B. ITC Reversed
    5 Values of exempt, nil-rated and non-GST inward supplies
  `, "gstr-3b-may-2024.pdf");

  assert.equal(parsed.documentType, "gstr3b");
  assert.equal(parsed.returnPeriod, "052024");
  assert.deepEqual(
    [parsed.summary.taxableOutward.taxableValue, parsed.summary.taxableOutward.igst, parsed.summary.itcClaimed.igst],
    [3121760, 146972.7, 490753.8],
  );
  assert.deepEqual(parsed.anomalies, []);
});

test("preserves built-in multi-period sales-register parsing when identity is saved", () => {
  const headers = [
    "Bill Date", "Bill No", "C/D", "Party Name", "Party GSTIN No",
    "Assessable Amount", "Central Tax-9.00%", "State/UT Tax-9.00%",
    "Integrated Tax-18.00%", "Bill Amount",
  ];
  const parsed = parseSalesRegisterMatrix([
    ["DEMO COMPANY", "GSTIN 29AABFB5678G1Z8"],
    headers,
    ["30/04/2025", "INV-1", "Debit", "Registered buyer", "27AABCM1234F1ZX", 860000, 54900, 54900, 45000, 1014800],
    ["02/05/2025", "CN-1", "Credit", "Registered buyer", "27AABCM1234F1ZX", 10000, 900, 900, 0, 11800],
  ], "sales-register.xlsx");

  assert.equal(parsed.documentType, "salesRegister");
  assert.equal(parsed.returnPeriod, null);
  assert.equal(parsed.periodCount, 2);
  assert.equal(parsed.periods["052025"].net.taxableValue, -10000);

  const remapped = applyFieldMapping(parsed, { documentType: "salesRegister", gstin: parsed.gstin, returnPeriod: "", fieldMap: parsed.suggestedFieldMap });
  assert.equal(remapped.rows.length, 2);
  assert.equal(remapped.periodCount, 2);
  assert.equal(remapped.periods["052025"].net.taxableValue, -10000);
  assert.ok(!remapped.anomalies.some((item) => item.code === "MISSING_RETURN_PERIOD"));
});
