import { BadgeCheck, Play, SlidersHorizontal } from "lucide-react";

export default function ReconciliationControls({ selectedCount, crossExamination, values, gstinValue, onChange, onGstinChange, onApplyGstin, running, applyingGstin, onRun }) {
  const selectionInvalid = selectedCount < 2 || selectedCount > 100;
  const gstinMismatch = crossExamination.status === "mismatch";
  const gstinMissing = crossExamination.status === "unverified";
  return (
    <section className="reconcile-bar" aria-labelledby="reconcile-heading">
      <div className="reconcile-copy"><span className="reconcile-icon"><SlidersHorizontal size={19} /></span><div><h2 id="reconcile-heading">Run reconciliation</h2><p>Selected files are compared without changing the originals.</p></div></div>
      <div className="tolerance-controls">
        <label className="field compact-field"><span>Price tolerance (₹)</span><input type="number" min="0" max="1000000" step="0.01" name="amountTolerance" value={values.amountTolerance} onChange={onChange} /></label>
        <label className="field compact-field"><span>Date tolerance (days)</span><input type="number" min="0" max="90" step="1" name="dateToleranceDays" value={values.dateToleranceDays} onChange={onChange} /></label>
        <label className="field compact-field"><span>Client GSTIN</span><input type="text" name="bulkGstin" value={gstinValue} onChange={onGstinChange} maxLength={15} pattern="\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]" placeholder="24ABCDE1234F1Z5" autoComplete="off" /></label>
        <button className="button button-secondary" type="button" onClick={onApplyGstin} disabled={!selectedCount || applyingGstin}>{applyingGstin ? <span className="spinner" /> : <BadgeCheck size={16} />}{applyingGstin ? "Applying…" : "Apply GSTIN"}</button>
      </div>
      <button className="button button-primary run-button" onClick={onRun} disabled={running || selectionInvalid || gstinMismatch || gstinMissing} title={gstinMismatch ? "Selected documents identify different client GSTINs." : gstinMissing ? "Map the client GSTIN before running reconciliation." : selectedCount > 100 ? "Reconciliation supports up to 100 selected files." : undefined}>{running ? <span className="spinner spinner-light" /> : <Play size={16} />}{running ? "Reconciling…" : gstinMismatch ? "Resolve GSTIN mismatch" : gstinMissing ? "Client GSTIN required" : selectedCount > 100 ? "Select up to 100 files" : `Run on ${selectedCount} files`}</button>
    </section>
  );
}
