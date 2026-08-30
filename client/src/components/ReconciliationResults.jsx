import { AlertOctagon, ArrowDownRight, ArrowUpRight, CheckCircle2, ClipboardCheck, Lightbulb, Scale } from "lucide-react";
import { money, period, TYPE_LABELS } from "../utils/format.js";

function Metric({ label, value, detail, tone = "neutral" }) {
  return <div className={`metric-card metric-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

export default function ReconciliationResults({ reconciliation, onModifyMapping }) {
  if (!reconciliation) return (
    <section className="panel results-empty" id="results"><ClipboardCheck size={30} /><div><h2>No reconciliation run yet</h2><p>Select GSTR-1 and GSTR-3B files, then run the comparison. A sales register adds books checks; GSTR-2B adds ITC checks.</p></div></section>
  );
  const { result } = reconciliation;
  const review = reconciliation.status === "needs_review";
  return (
    <section className="results-section" id="results" aria-labelledby="results-heading">
      <div className="results-title-row">
        <div><p className="eyebrow">Reconciliation report</p><h2 id="results-heading">{period(result.returnPeriod)} · <span className="mono">{result.clientGstin || "GSTIN not detected"}</span></h2><p>{result.methodology}</p></div>
        <span className={`report-status ${review ? "report-review" : "report-matched"}`}>{review ? <AlertOctagon size={16} /> : <CheckCircle2 size={16} />}{review ? "Review required" : "Matched"}</span>
      </div>
      <div className="metric-grid">
        <Metric label="Checks matched" value={`${result.summary.matched} / ${result.summary.totalChecks}`} detail="Within configured tolerance" tone="success" />
        <Metric label="Value differences" value={result.summary.mismatched} detail={money(result.summary.totalAbsoluteDifference)} tone={result.summary.mismatched ? "warning" : "success"} />
        <Metric label="Data exceptions" value={result.summary.exceptions} detail="Identity, period or source checks" tone={result.summary.exceptions ? "warning" : "neutral"} />
        <Metric label="High priority" value={result.summary.highRisk} detail="Resolve before relying on return" tone={result.summary.highRisk ? "danger" : "success"} />
      </div>
      <div className="panel result-panel">
        <div className="section-heading"><div><h3>Books, liability and ITC comparison</h3><p>Sales-register values flow through GSTR-1 to GSTR-3B; optional GSTR-2B values add ITC checks.</p></div></div>
        <div className="table-scroll result-table-scroll">
          <table>
            <thead><tr><th>Table</th><th>Check</th><th>Measure</th><th className="number-cell">Source</th><th className="number-cell">Compared with</th><th className="number-cell">Difference</th><th>Status</th><th>Suggested review</th></tr></thead>
            <tbody>{result.comparisons.map((item) => (
              <tr key={item.id} className={item.status === "mismatch" ? "mismatch-row" : ""}>
                <td><span className="section-code">{item.table}</span></td><td>{item.label}</td><td>{item.measureLabel}</td><td className="number-cell comparison-value"><small>{item.sourceLabel || "Source"}</small>{money(item.sourceValue)}</td><td className="number-cell comparison-value"><small>{item.filedLabel || "GSTR-3B"}</small>{money(item.filedValue)}</td><td className={`number-cell difference-${item.difference > 0 ? "positive" : item.difference < 0 ? "negative" : "zero"}`}>{item.difference > 0 ? <ArrowUpRight size={14} /> : item.difference < 0 ? <ArrowDownRight size={14} /> : null}{money(item.difference)}</td>
                <td><span className={`status-pill status-${item.status === "matched" ? "success" : "warning"}`}>{item.status === "matched" ? <CheckCircle2 size={13} /> : <AlertOctagon size={13} />}{item.status === "matched" ? "Matched" : item.risk === "high" ? "High priority" : "Review"}</span></td>
                <td className="suggestion-cell">{item.suggestion}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
      {result.exceptions.length ? (
        <div className="panel exception-panel">
          <div className="section-heading"><div><h3>Document exceptions</h3><p>Extraction and integrity checks that need auditor attention.</p></div><span className="count-badge">{result.exceptions.length}</span></div>
          <div className="exception-list">{result.exceptions.map((item, index) => (
            <article key={`${item.code}-${index}`} className={`exception-item exception-${item.severity}`}>
              <AlertOctagon size={17} /><div><div className="exception-heading"><strong>{item.message}</strong><span>{item.code.replaceAll("_", " ")}</span></div>{item.documentName ? <small>{item.documentName}</small> : null}<p>{item.suggestion}</p></div>
              {item.documentId ? <button className="text-button" onClick={() => onModifyMapping(item.documentId)}>Modify mapping</button> : null}
            </article>
          ))}</div>
        </div>
      ) : null}
      {result.suggestions.length ? (
        <div className="suggestion-panel"><Lightbulb size={20} /><div><h3>Suggested review sequence</h3><ol>{result.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ol></div></div>
      ) : null}
      <div className="source-strip"><Scale size={16} /><span>Files used:</span>{result.documents.map((document) => <span key={document.id} className="source-chip"><strong>{TYPE_LABELS[document.documentType]}</strong>{document.originalName}</span>)}</div>
    </section>
  );
}

