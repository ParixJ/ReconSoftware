import { AlertTriangle, CircleHelp, Play, ShieldCheck, SlidersHorizontal } from "lucide-react";

function crossExaminationCopy(result) {
  if (result.status === "mismatch") {
    const identities = result.gstinGroups.map((group) => `${group.gstin}: ${group.documents.map((document) => document.originalName).join(", ")}`).join(" · ");
    return { title: "Client GSTIN mismatch", message: `${identities}. Remove unrelated files or correct their mappings.` };
  }
  if (result.status === "matched") return { title: "GSTIN cross-examination passed", message: `All ${result.documentCount} selected files identify ${result.clientGstin}.` };
  if (result.status === "partial") return { title: "GSTIN cross-examination is partial", message: `${result.identifiedCount} of ${result.documentCount} files identify ${result.clientGstin}. Comparisons involving a missing GSTIN will be withheld until its mapping is corrected.` };
  if (result.status === "unverified") return { title: "Client GSTINs are not detected", message: "Add client GSTIN mappings to enable safe document comparisons." };
  return { title: "GSTIN cross-examination", message: "Select documents to verify that they belong to one client." };
}

export default function ReconciliationControls({ selectedCount, crossExamination, values, onChange, onRun, running }) {
  const selectionInvalid = selectedCount < 2 || selectedCount > 10;
  const gstinMismatch = crossExamination.status === "mismatch";
  const crossExaminationText = crossExaminationCopy(crossExamination);
  const CrossExaminationIcon = gstinMismatch ? AlertTriangle : crossExamination.status === "matched" ? ShieldCheck : CircleHelp;
  return (
    <section className="reconcile-bar" aria-labelledby="reconcile-heading">
      <div className="reconcile-copy"><span className="reconcile-icon"><SlidersHorizontal size={19} /></span><div><p className="eyebrow">Step 3</p><h2 id="reconcile-heading">Run reconciliation</h2><p>Selected files are compared without changing the originals.</p></div></div>
      <div className="tolerance-controls">
        <label className="field compact-field"><span>Price tolerance (₹)</span><input type="number" min="0" max="1000000" step="0.01" name="amountTolerance" value={values.amountTolerance} onChange={onChange} /></label>
        <label className="field compact-field"><span>Date tolerance (days)</span><input type="number" min="0" max="90" step="1" name="dateToleranceDays" value={values.dateToleranceDays} onChange={onChange} /></label>
      </div>
      <button className="button button-primary run-button" onClick={onRun} disabled={running || selectionInvalid || gstinMismatch} title={gstinMismatch ? "Selected documents identify different client GSTINs." : selectedCount > 10 ? "Reconciliation supports up to 10 selected files." : undefined}>{running ? <span className="spinner spinner-light" /> : <Play size={16} />}{running ? "Reconciling…" : gstinMismatch ? "Resolve GSTIN mismatch" : selectedCount > 10 ? "Select up to 10 files" : `Run on ${selectedCount} files`}</button>
      <div className={`gstin-cross-examination gstin-cross-examination-${crossExamination.status}`} role="status" aria-live="polite">
        <CrossExaminationIcon size={17} />
        <div><strong>{crossExaminationText.title}</strong><p>{crossExaminationText.message}</p></div>
      </div>
    </section>
  );
}
