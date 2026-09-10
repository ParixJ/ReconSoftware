import { useState } from "react";
import { AlertOctagon, ArrowDownRight, ArrowUpRight, CheckCircle2, ClipboardCheck, Download, Eye, Lightbulb, Scale } from "lucide-react";
import { errorMessage, reconciliationApi } from "../api/client.js";
import { money, period, TYPE_LABELS } from "../utils/format.js";
import Notice from "./Notice.jsx";
import Popup from "./Popup.jsx";

const FISCAL_YEAR_PATTERN = /^(\d{4})-(\d{4})$/;

function Metric({ label, value, detail, tone = "neutral" }) {
  return <div className={`metric-card metric-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function fiscalYearForPeriod(returnPeriod) {
  if (!/^(0[1-9]|1[0-2])\d{4}$/.test(returnPeriod || "")) return null;
  const month = Number(returnPeriod.slice(0, 2));
  const year = Number(returnPeriod.slice(2));
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

function defaultFiscalYear(periods) {
  const fiscalYears = [...new Set(periods.map((item) => fiscalYearForPeriod(item.returnPeriod)).filter(Boolean))];
  return fiscalYears.length === 1 ? fiscalYears[0] : "";
}

function fiscalYearIsValid(value) {
  const match = String(value || "").trim().match(FISCAL_YEAR_PATTERN);
  return Boolean(match && Number(match[2]) === Number(match[1]) + 1);
}

function defaultExportName(clientGstin, fiscalYear) {
  return `GST_Reconciliation_${clientGstin || "Client"}_${fiscalYear || "FY"}`;
}

function dispositionFilename(disposition, fallback) {
  return disposition.match(/filename="?([^";]+)"?/i)?.[1] || `${fallback || "GST_Reconciliation"}.xlsx`;
}

function periodPriority(result) {
  if (Number(result.summary?.highRisk || 0) > 0) return { label: "High priority", tone: "warning", icon: AlertOctagon };
  if (result.status === "matched") return { label: "Matched", tone: "success", icon: CheckCircle2 };
  return { label: "Review required", tone: "warning", icon: AlertOctagon };
}

function documentSummary(documents = []) {
  const counts = documents.reduce((summary, document) => {
    const label = TYPE_LABELS[document.documentType] || "Document";
    summary.set(label, (summary.get(label) || 0) + 1);
    return summary;
  }, new Map());
  return [...counts.entries()].map(([label, count]) => `${count} ${label}`).join(", ") || "No files";
}

function PeriodReport({ result, onModifyMapping }) {
  return (
    <div className="period-result">
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

function MonthlyResultsTable({ periods, onOpen }) {
  return (
    <div className="panel result-panel monthly-results-panel">
      <div className="section-heading"><div><h3>Monthly reconciliation summary</h3><p>Open a month to review the detailed comparison rows and document exceptions.</p></div><span className="count-badge">{periods.length} month{periods.length === 1 ? "" : "s"}</span></div>
      <div className="table-scroll monthly-results-scroll">
        <table className="monthly-results-table" aria-label="Monthly reconciliation summary">
          <thead><tr><th>Month</th><th>Status</th><th className="number-cell">Total difference</th><th className="number-cell">Checks</th><th className="number-cell">Exceptions</th><th>Files</th><th className="action-cell">Details</th></tr></thead>
          <tbody>{periods.map((item, index) => {
            const priority = periodPriority(item);
            const PriorityIcon = priority.icon;
            return (
              <tr key={item.returnPeriod || `unassigned-${index}`} className="monthly-result-row" tabIndex={0} onClick={() => onOpen(item)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(item); } }}>
                <td><span className="month-cell">{period(item.returnPeriod)}</span><small>{item.clientGstin || "GSTIN not detected"}</small></td>
                <td><span className={`status-pill status-${priority.tone}`}><PriorityIcon size={13} />{priority.label}</span></td>
                <td className="number-cell">{money(item.summary?.totalAbsoluteDifference)}</td>
                <td className="number-cell">{Number(item.summary?.matched || 0)} / {Number(item.summary?.totalChecks || 0)}</td>
                <td className="number-cell">{Number(item.summary?.exceptions || 0)}</td>
                <td className="monthly-files-cell">{documentSummary(item.documents)}</td>
                <td className="action-cell"><button className="text-button" type="button" onClick={(event) => { event.stopPropagation(); onOpen(item); }} aria-label={`View ${period(item.returnPeriod)} details`}><Eye size={14} />View details</button></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

export default function ReconciliationResults({ reconciliation, onModifyMapping }) {
  const [activePeriod, setActivePeriod] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportForm, setExportForm] = useState({ documentName: "", format: "excel", fiscalYear: "" });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  if (!reconciliation) return (
    <section className="panel results-empty" id="results"><ClipboardCheck size={30} /><div><h2>No reconciliation run yet</h2><p>Select GSTR-1 and GSTR-3B files, then run the comparison. A sales register adds books checks; GSTR-2B adds ITC checks.</p></div></section>
  );
  const { result } = reconciliation;
  const review = reconciliation.status === "needs_review";
  const resultPeriods = result.periods?.length ? result.periods : [{ ...result, status: reconciliation.status }];
  const resultYears = [...new Set(resultPeriods.map((item) => item.returnPeriod?.slice(2)).filter((year) => /^\d{4}$/.test(year || "")))];
  const exportFiscalYear = defaultFiscalYear(resultPeriods);
  const canExport = Boolean(result.clientGstin);
  const knownPeriodCount = resultPeriods.filter((item) => item.returnPeriod).length;
  const headingPeriod = knownPeriodCount > 1 ? `${knownPeriodCount} return periods` : period(resultPeriods[0]?.returnPeriod || result.returnPeriod);

  const openExportPopup = () => {
    const fiscalYear = exportFiscalYear || (resultYears.length === 1 ? `${resultYears[0]}-${Number(resultYears[0]) + 1}` : "");
    setExportError("");
    setExportForm({ documentName: defaultExportName(result.clientGstin, fiscalYear), format: "excel", fiscalYear });
    setExportOpen(true);
  };

  const exportToExcel = async (event) => {
    event.preventDefault();
    const fiscalYear = exportForm.fiscalYear.trim();
    if (!fiscalYearIsValid(fiscalYear)) {
      setExportError("Enter the fiscal year in exact YYYY-YYYY format, for example 2025-2026.");
      return;
    }
    if (exportForm.format !== "excel") {
      setExportError("Only Excel export is available right now.");
      return;
    }
    setExporting(true);
    setExportError("");
    try {
      const response = await reconciliationApi.exportWorkbook(result.clientGstin, {
        fiscalYear,
        filename: exportForm.documentName,
        format: exportForm.format,
      });
      const disposition = response.headers["content-disposition"] || "";
      const filename = dispositionFilename(disposition, exportForm.documentName || defaultExportName(result.clientGstin, fiscalYear));
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setExportOpen(false);
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
        <div className="results-actions"><span className={`report-status ${review ? "report-review" : "report-matched"}`}>{review ? <AlertOctagon size={16} /> : <CheckCircle2 size={16} />}{review ? "Review required" : "Matched"}</span><button className="button button-secondary export-button" onClick={openExportPopup} disabled={!canExport || exporting}>{exporting ? <span className="spinner" /> : <Download size={16} />}{exporting ? "Preparing Excel…" : "Export to Excel"}</button></div>
      </div>
      <div className="metric-grid">
        <Metric label="Checks matched" value={`${result.summary.matched} / ${result.summary.totalChecks}`} detail="Across all selected periods" tone="success" />
        <Metric label="Value differences" value={result.summary.mismatched} detail={money(result.summary.totalAbsoluteDifference)} tone={result.summary.mismatched ? "warning" : "success"} />
        <Metric label="Data exceptions" value={result.summary.exceptions} detail="Identity, period or source checks" tone={result.summary.exceptions ? "warning" : "neutral"} />
        <Metric label="High priority" value={result.summary.highRisk} detail="Resolve before relying on return" tone={result.summary.highRisk ? "danger" : "success"} />
      </div>
      <MonthlyResultsTable periods={resultPeriods} onOpen={setActivePeriod} />
      <Popup open={Boolean(activePeriod)} title={`${period(activePeriod?.returnPeriod)} reconciliation details`} description="Detailed comparison rows, document exceptions, suggestions, and source files for the selected month." onClose={() => setActivePeriod(null)} size="wide">
        {activePeriod ? <PeriodReport result={activePeriod} onModifyMapping={(id) => { setActivePeriod(null); onModifyMapping(id); }} /> : null}
      </Popup>
      <Popup
        open={exportOpen}
        title="Export reconciliation"
        description="Enter the file details for the reconciliation export."
        onClose={() => { if (!exporting) setExportOpen(false); }}
        footer={
          <>
            <button className="button button-secondary" type="button" onClick={() => setExportOpen(false)} disabled={exporting}>Cancel</button>
            <button className="button button-primary" type="submit" form="reconciliation-export-form" disabled={exporting}>{exporting ? <span className="spinner spinner-light" /> : <Download size={16} />}{exporting ? "Preparing..." : "Download"}</button>
          </>
        }
      >
        <form id="reconciliation-export-form" className="export-form" onSubmit={exportToExcel}>
          <label className="field"><span>Document name</span><input value={exportForm.documentName} onChange={(event) => setExportForm((current) => ({ ...current, documentName: event.target.value }))} placeholder="GST_Reconciliation_Client_FY" autoComplete="off" /></label>
          <label className="field"><span>Document file format</span><select value={exportForm.format} onChange={(event) => setExportForm((current) => ({ ...current, format: event.target.value }))}><option value="excel">Excel (.xlsx)</option></select></label>
          <label className="field"><span>Fiscal year</span><input value={exportForm.fiscalYear} onChange={(event) => setExportForm((current) => ({ ...current, fiscalYear: event.target.value }))} placeholder="2025-2026" pattern="\d{4}-\d{4}" required autoComplete="off" /></label>
        </form>
        {exportError ? <Notice tone="danger" title="Excel export failed" onClose={() => setExportError("")}>{exportError}</Notice> : null}
      </Popup>
    </section>
  );
}
