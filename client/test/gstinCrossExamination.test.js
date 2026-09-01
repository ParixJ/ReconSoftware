import assert from "node:assert/strict";
import test from "node:test";
import { crossExamineClientGstins } from "../src/utils/gstinCrossExamination.js";

const document = (id, documentType, gstin) => ({ id, originalName: `${id}.json`, documentType, gstin });

test("passes only one identified client GSTIN across selected document types", () => {
  const gstin = "29aabfb5678g1z8";
  const result = crossExamineClientGstins([
    document("books", "salesRegister", gstin),
    document("gstr1", "gstr1", gstin.toUpperCase()),
    document("gstr3b", "gstr3b", gstin),
  ]);

  assert.equal(result.status, "matched");
  assert.equal(result.canReconcile, true);
  assert.equal(result.clientGstin, gstin.toUpperCase());
  assert.equal(result.gstinGroups.length, 1);
  assert.equal(result.identifiedCount, 3);
});

test("blocks a sales register selected with another client's returns", () => {
  const result = crossExamineClientGstins([
    document("books", "salesRegister", "29AABFB5678G1Z8"),
    document("gstr1", "gstr1", "24AEXPS3034H1Z6"),
    document("gstr3b", "gstr3b", "24AEXPS3034H1Z6"),
  ]);

  assert.equal(result.status, "mismatch");
  assert.equal(result.canReconcile, false);
  assert.equal(result.clientGstin, null);
  assert.deepEqual(result.gstinGroups.map((group) => group.gstin), ["29AABFB5678G1Z8", "24AEXPS3034H1Z6"]);
});

test("reports missing GSTINs without treating them as a client match", () => {
  const partial = crossExamineClientGstins([
    document("gstr1", "gstr1", null),
    document("gstr3b", "gstr3b", "29AABFB5678G1Z8"),
  ]);
  const unverified = crossExamineClientGstins([
    document("gstr1", "gstr1", null),
    document("gstr3b", "gstr3b", null),
  ]);

  assert.equal(partial.status, "partial");
  assert.equal(partial.missingDocuments[0].id, "gstr1");
  assert.equal(unverified.status, "unverified");
  assert.equal(unverified.clientGstin, null);
});
