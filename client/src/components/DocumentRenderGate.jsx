import { Columns3, Eye, EyeOff, FileCog, ShieldQuestion } from "lucide-react";

function originalValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function OriginalTable({ detail, onDecision, onMap, saving }) {
  const fields = detail.parsed.sourceFields || [];
  const rows = detail.parsed.sourceRows || [];
  return (
    <div className="original-view">
      <div className="original-view-banner">
        <Columns3 size={18} />
        <div><strong>Showing original extracted fields</strong><p>Column names and values are rendered as extracted because the expected reconciliation mapping is incomplete.</p></div>
        <button className="button button-quiet" onClick={() => onDecision("hidden")} disabled={saving}><EyeOff size={16} />Hide table</button>
        <button className="button button-secondary" onClick={onMap}><FileCog size={16} />Modify mapping</button>
      </div>
      <div className="table-scroll rows-table-scroll">
        <table className="raw-data-table">
          <thead><tr><th>#</th>{fields.map((field) => <th key={field}>{field}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => (
            <tr key={index}><td className="row-number">{index + 1}</td>{fields.map((field) => {
              const value = originalValue(row[field]);
              return <td key={field} title={value}>{value}</td>;
            })}</tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

export default function DocumentRenderGate({ detail, onDecision, onMap, saving }) {
  const coverage = detail.mappingCoverage;
  if (!coverage || coverage.viewMode === "normalized") return null;
  if (coverage.viewMode === "original") return <OriginalTable detail={detail} onDecision={onDecision} onMap={onMap} saving={saving} />;
  if (coverage.viewMode === "hidden") {
    return (
      <div className="render-decision render-hidden" role="status">
        <span className="decision-icon"><EyeOff size={24} /></span>
        <div><p className="eyebrow">Table hidden</p><h3>Document fields are not being rendered</h3><p>The expected reconciliation fields are still incomplete. You chose not to display the extracted source table.</p></div>
        {coverage.hasOriginalFields ? <button className="button button-secondary" onClick={() => onDecision("original")} disabled={saving}><Eye size={16} />Render original columns</button> : null}
        <button className="button button-primary" onClick={onMap}><FileCog size={16} />Modify mapping</button>
      </div>
    );
  }
  return (
    <div className="render-decision" role="alertdialog" aria-labelledby="render-decision-title" aria-describedby="render-decision-copy">
      <span className="decision-icon"><ShieldQuestion size={26} /></span>
      <div className="decision-copy">
        <p className="eyebrow">Mapping confirmation required</p>
        <h3 id="render-decision-title">Expected reconciliation fields were not mapped</h3>
        <p id="render-decision-copy">Would you like to render the fields exactly as extracted from the original document?</p>
        {coverage.missingFields.length ? <p className="missing-fields"><strong>Missing expected fields:</strong> {coverage.missingFields.join(", ")}</p> : null}
        <div className="source-field-list" aria-label="Extracted source columns">{detail.parsed.sourceFields.map((field) => <span key={field}>{field}</span>)}</div>
      </div>
      <div className="decision-actions">
        <button className="button button-primary" onClick={() => onDecision("original")} disabled={saving}><Eye size={16} />{saving ? "Saving…" : "Render original columns"}</button>
        <button className="button button-secondary" onClick={() => onDecision("hidden")} disabled={saving}><EyeOff size={16} />Do not render</button>
        <button className="text-button" onClick={onMap}><FileCog size={15} />Modify mapping instead</button>
      </div>
    </div>
  );
}

