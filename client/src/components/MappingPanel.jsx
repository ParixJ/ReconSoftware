import { useEffect, useState } from "react";
import { ArrowLeft, Save, WandSparkles } from "lucide-react";
import Notice from "./Notice.jsx";
import { errorMessage } from "../api/client.js";

const fieldLabels = {
  counterpartyGstin: "Counterparty GSTIN", tradeName: "Trade name", invoiceNumber: "Invoice number", invoiceDate: "Invoice date",
  invoiceValue: "Invoice value", taxableValue: "Taxable value", placeOfSupply: "Place of supply", reverseCharge: "Reverse charge",
  igst: "IGST", cgst: "CGST", sgst: "SGST / UTGST", cess: "Cess",
};

export default function MappingPanel({ document, onClose, onSave, saving }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (document) setForm({
      documentType: document.mapping?.documentType || document.documentType,
      gstin: document.mapping?.gstin || document.gstin || "",
      returnPeriod: document.mapping?.returnPeriod || document.returnPeriod || "",
      fieldMap: document.mapping?.fieldMap || document.parsed.suggestedFieldMap || {},
    });
  }, [document]);
  if (!document || !form) return <div className="mapping-page"><div className="loading-block">Loading mapping…</div></div>;
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const updateMap = (key, value) => setForm((current) => ({ ...current, fieldMap: { ...current.fieldMap, [key]: value } }));
  const submit = async (event) => {
    event.preventDefault(); setError("");
    try { await onSave(form); } catch (requestError) { setError(errorMessage(requestError)); }
  };
  return (
    <main className="mapping-page">
      <div className="mapping-header"><button className="button button-quiet" onClick={onClose}><ArrowLeft size={17} />Back to Home</button><div><p className="eyebrow">Modify mapping</p><h1>{document.originalName}</h1><p>Confirm return identity and map recognized source columns to fixed reconciliation fields.</p></div></div>
      <form className="mapping-layout" onSubmit={submit}>
        <section className="panel mapping-section">
          <div className="section-heading"><div><h2>Return identity</h2><p>These values are used to group the client and filing period.</p></div><WandSparkles size={20} /></div>
          {error ? <Notice tone="danger" title="Mapping was not saved">{error}</Notice> : null}
          <div className="form-grid">
            <label className="field"><span>Document type</span><select name="documentType" value={form.documentType} onChange={update}><option value="unknown">Choose document type</option><option value="salesRegister">Sales register</option><option value="gstr1">GSTR-1</option><option value="gstr2">GSTR-2</option><option value="gstr2b">GSTR-2B</option><option value="gstr3b">GSTR-3B</option></select></label>
            <label className="field"><span>Client GSTIN</span><input name="gstin" value={form.gstin} onChange={update} maxLength={15} placeholder="24ABCDE1234F1Z5" /></label>
            <label className="field"><span>Return period</span><input name="returnPeriod" value={form.returnPeriod} onChange={update} inputMode="numeric" maxLength={6} placeholder="MMYYYY" /><small>Use six digits, for example 032026.</small></label>
          </div>
        </section>
        <section className="panel mapping-section">
          <div className="section-heading"><div><h2>Column mapping</h2><p>The target schema is fixed. Custom columns cannot be added.</p></div><span className="count-badge">{document.parsed.sourceFields.length} source fields</span></div>
          {!document.parsed.sourceFields.length ? (
            <Notice tone="info" title="Official GST schema recognized">This file uses a built-in nested GST return mapping. Confirm the return identity above; invoice and tax fields are already mapped to the fixed table.</Notice>
          ) : (
            <div className="mapping-table-wrap"><table className="mapping-table"><thead><tr><th>Reconciliation field</th><th>Source column</th><th>Sample value</th></tr></thead><tbody>{Object.entries(fieldLabels).map(([key, label]) => {
              const selected = form.fieldMap[key] || "";
              const sample = selected ? document.parsed.sourceRows?.find((row) => row[selected] !== "" && row[selected] != null)?.[selected] : "";
              return <tr key={key}><td><strong>{label}</strong></td><td><select value={selected} onChange={(event) => updateMap(key, event.target.value)}><option value="">Not mapped</option>{document.parsed.sourceFields.map((field) => <option key={field} value={field}>{field}</option>)}</select></td><td className="sample-cell">{String(sample || "—")}</td></tr>;
            })}</tbody></table></div>
          )}
        </section>
        <div className="mapping-actions"><p>Saving recalculates extracted rows and anomaly flags. The original file is never modified.</p><div><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? <span className="spinner spinner-light" /> : <Save size={16} />}Save mapping</button></div></div>
      </form>
    </main>
  );
}

