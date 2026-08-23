# Reconciliation fixtures

`gstr1-march-2026.json` and `gstr3b-march-2026.json` form a deterministic liability reconciliation pair. They intentionally contain a ₹500 taxable-value difference and ₹45 differences in CGST and SGST so the review workflow exercises mismatch suggestions.

The provided GST portal GSTR-2B sample remains at `docs/returns_R2B_24AEXPS3034H1Z6_032026.json` and uses the same client GSTIN/period. End-to-end validation uploads all three documents, adding ITC checks to the same reconciliation.

