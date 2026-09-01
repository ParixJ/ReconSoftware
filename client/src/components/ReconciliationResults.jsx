import { useState } from "react";
import { AlertOctagon, ArrowDownRight, ArrowUpRight, CalendarRange, CheckCircle2, ClipboardCheck, Download, Lightbulb, Scale } from "lucide-react";
import { errorMessage, reconciliationApi } from "../api/client.js";
import { money, period, TYPE_LABELS } from "../utils/format.js";
import Notice from "./Notice.jsx";

function Metric({ label, value, detail, tone = "neutral" }) {
  return <div className={`metric-card metric-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function PeriodReport({ result, onModifyMapping }) {
  return (
    <div className="period-result" role="tabpanel">
      <div className="panel result-panel">
        <div className="section-heading"><div><h3>Books, liability and ITC comparison</h3><p>Sales-register values flow independently to this month&apos;s GSTR-1 and GSTR-3B; optional GSTR-2B values add ITC checks.</p></div><span className={`report-status ${result.status === "matched" ? "report-matched" : "report-review"}`}>{result.status === "matched" ? <CheckCircle2 size={14} /> : <AlertOctagon size={14} />}{result.status === "matched" ? "Matched" : "Review required"}</span></div>
        {result.comparisons.length ? (
          <div className="table-scroll result-table-scroll">
            <table>
              <thead><tr><th>Table</th><th>Check</th><th>Field</th><th className="number-cell">Source</th><th className="number-cell">Compared with</th><th className="number-cell">Difference</th><th>Status</th><th>Suggested review</th></tr></thead>
              <tbody>{result.comparisons.map((item) => (
                <tr key={item.id} className={item.status === "mismatch" ? "mismatch-row" : ""}>
                  <td><span className="section-code">{item.table}</span></td><td>{item.label}</td><td>{item.measureLabel}</td><td className="number-cell comparison-value"><small>{item.sourceLabel || "Source"}</small>{money(item.sourceValue)}</td><td className="number-cell comparison-value"><small>{item.filedLabel || "GSTR-3B"}</small>{money(item.filedValue)}</td><td className={`number-cell difference-${item.difference > 0 ? "positive" : item.difference < 0 ? "negative" : "zero"}`}>{item.difference > 0 ? <ArrowUpRight size={14} /> : item.difference < 0 ? <ArrowDownRight size={14} /> : null}{money(item.difference)}</td>
                  <td><span className={`status-pill status-${item.status === "matched" ? "success" : "warning"}`}>{item.status === "matched" ? <CheckCircle2 size={13} /> : <AlertOctagon size={13} />}{item.status === "matched" ? "Matched" : item.risk === "high" ? "High priority" : "Review"}</span></td>
                  <td className="suggestion-cell">{item.suggestion}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="empty-state period-comparison-empty"><ClipboardCheck size={24} /><strong>No safe comparisons for this period</strong><p>Resolve the period exceptions before comparing return values.</p></div>}
      </div>
      {result.exceptions.length ? (
        <div className="panel exception-panel">
          <div className="section-heading"><div><h3>Document exceptions</h3><p>Extraction and integrity checks for {period(result.returnPeriod).toLowerCase()} that need auditor attention.</p></div><span className="count-badge">{result.exceptions.length}</span></div>
          <div className="exception-list">{result.exceptions.map((item) => (
            <article key={item.id} className={`exception-item exception-${item.severity}`} data-exception-id={item.id}>
              <AlertOctagon size={17} /><div><div className="exception-heading"><strong>{item.message}</strong><span>{item.code.replaceAll("_", " ")}</span></div>{item.documentName ? <small>{item.documentName}</small> : null}<p>{item.suggestion}</p></div>
              {item.documentId ? <button className="text-button" onClick={() => onModifyMapping(item.documentId)}>Modify mapping</button> : null}
            </article>
          ))}</div>
        </div>
      ) : null}
      {result.suggestions.length ? (
        <div className="suggestion-panel"><Lightbulb size={20} /><div><h3>Suggested review sequence</h3><ol>{result.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ol></div></div>
      ) : null}
      <div className="source-strip"><Scale size={16} /><span>Files used for {period(result.returnPeriod)}:</span>{result.documents.map((document) => <span key={document.id} className="source-chip"><strong>{TYPE_LABELS[document.documentType]}</strong>{document.originalName}</span>)}</div>
    </div>
  );
}

function PeriodTabs({ periods, onModifyMapping }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = periods[Math.min(activeIndex, periods.length - 1)];
  return (
    <>
      <div className="reconciliation-period-tabs" role="tablist" aria-label="Reconciliation periods">
        {periods.map((item, index) => (
          <button key={item.returnPeriod || `unassigned-${index}`} className={`reconciliation-period-tab ${index === activeIndex ? "reconciliation-period-tab-active" : ""}`} role="tab" aria-selected={index === activeIndex} onClick={() => setActiveIndex(index)}>
            <CalendarRange size={16} /><span><strong>{period(item.returnPeriod)}</strong><small>{item.summary.matched}/{item.summary.totalChecks} checks · {item.summary.exceptions} exceptions</small></span>
          </button>
        ))}
      </div>
      <PeriodReport result={active} onModifyMapping={onModifyMapping} />
    </>
  );
}

export default function ReconciliationResults({ reconciliation, onModifyMapping }) {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  if (!reconciliation) return (
    <section className="panel results-empty" id="results"><ClipboardCheck size={30} /><div><h2>No reconciliation run yet</h2><p>Select GSTR-1 and GSTR-3B files, then run the comparison. A sales register adds books checks; GSTR-2B adds ITC checks.</p></div></section>
  );
  const { result } = reconciliation;
  const review = reconciliation.status === "needs_review";
  const resultPeriods = result.periods?.length ? result.periods : [{ ...result, status: reconciliation.status }];
  const resultYears = [...new Set(resultPeriods.map((item) => item.returnPeriod?.slice(2)).filter((year) => /^\d{4}$/.test(year || "")))];
  const exportYear = resultYears.length === 1 ? resultYears[0] : null;
  const canExport = Boolean(result.clientGstin && exportYear);
  const knownPeriodCount = resultPeriods.filter((item) => item.returnPeriod).length;
  const headingPeriod = knownPeriodCount > 1 ? `${knownPeriodCount} return periods` : period(resultPeriods[0]?.returnPeriod || result.returnPeriod);
  const exportToExcel = async () => {
    setExporting(true);
    setExportError("");
    try {
      const response = await reconciliationApi.exportWorkbook(result.clientGstin, exportYear);
      const disposition = response.headers["content-disposition"] || "";
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `GST_Reconciliation_${result.clientGstin}_${exportYear}.xlsx`;
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (requestError) {
      let message = errorMessage(requestError, "The Excel reconciliation could not be generated.");
      if (requestError.response?.data instanceof Blob) {
        try {
          const payload = JSON.parse(await requestError.response.data.text());
          message = payload.error?.message || message;
        } catch {
          // The server did not return its standard JSON error body.
        }
      }
      setExportError(message);
    } finally {
      setExporting(false);
    }
  };
  return (
    <section className="results-section" id="results" aria-labelledby="results-heading">
      <div className="results-title-row">
        <div><p className="eyebrow">Reconciliation report</p><h2 id="results-heading">{headingPeriod} · <span className="mono">{result.clientGstin || "GSTIN not detected"}</span></h2><p>{result.methodology}</p></div>
        <div className="results-actions"><span className={`report-status ${review ? "report-review" : "report-matched"}`}>{review ? <AlertOctagon size={16} /> : <CheckCircle2 size={16} />}{review ? "Review required" : "Matched"}</span><button className="button button-secondary export-button" onClick={exportToExcel} disabled={!canExport || exporting}>{exporting ? <span className="spinner" /> : <Download size={16} />}{exporting ? "Preparing Excel…" : "Export to Excel"}</button></div>
      </div>
      {exportError ? <Notice tone="danger" title="Excel export failed" onClose={() => setExportError("")}>{exportError}</Notice> : null}
      <div className="metric-grid">
        <Metric label="Checks matched" value={`${result.summary.matched} / ${result.summary.totalChecks}`} detail="Across all selected periods" tone="success" />
        <Metric label="Value differences" value={result.summary.mismatched} detail={money(result.summary.totalAbsoluteDifference)} tone={result.summary.mismatched ? "warning" : "success"} />
        <Metric label="Data exceptions" value={result.summary.exceptions} detail="Identity, period or source checks" tone={result.summary.exceptions ? "warning" : "neutral"} />
        <Metric label="High priority" value={result.summary.highRisk} detail="Resolve before relying on return" tone={result.summary.highRisk ? "danger" : "success"} />
      </div>
      <PeriodTabs key={reconciliation.id} periods={resultPeriods} onModifyMapping={onModifyMapping} />
    </section>
  );
}
