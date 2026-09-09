import { AlertTriangle, FileCog, FileSearch, LoaderCircle, X } from "lucide-react";
import { TYPE_LABELS } from "../utils/format.js";

function originalValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function DocumentTabs({ selectedDocuments, activeId, onActive, onRemove, onMap, detail, loading }) {
  return (
    <section className="panel viewer-panel" aria-labelledby="viewer-heading">
      <div className="section-heading viewer-heading"><div><p className="eyebrow">Document browser</p><h2 id="viewer-heading">Return document data</h2></div></div>
      {!selectedDocuments.length ? (
        <div className="empty-state viewer-empty"><FileSearch size={28} /><strong>Select documents to inspect</strong><p>The selected returns will open here as browser-style tabs.</p></div>
      ) : (
        <>
          <div className="document-tabs" role="tablist" aria-label="Selected return files">
            {selectedDocuments.map((document) => (
              <button key={document.id} className={`document-tab ${activeId === document.id ? "document-tab-active" : ""}`} onClick={() => onActive(document.id)} role="tab" aria-selected={activeId === document.id}>
                <span className={`tab-dot tab-${document.documentType}`} />
                <span><strong>{TYPE_LABELS[document.documentType]}</strong><small title={document.originalName}>{document.originalName}</small></span>
                <span className="tab-close" role="button" tabIndex="0" aria-label={`Remove ${document.originalName} from selection`} onClick={(event) => { event.stopPropagation(); onRemove(document.id); }} onKeyDown={(event) => { if (event.key === "Enter") { event.stopPropagation(); onRemove(document.id); } }}><X size={14} /></span>
              </button>
            ))}
          </div>
          <div className="tab-content" role="tabpanel">
            {loading || !detail ? <div className="loading-block"><LoaderCircle className="spin" size={22} />Loading extracted rows…</div> : (
              <>
                <div className="document-meta-strip">
                  <span><small>Client GSTIN</small><strong className="mono">{detail.gstin || "Not detected"}</strong></span>
                  <span><small>Return type</small><strong>{TYPE_LABELS[detail.documentType]}</strong></span>
                  <span><small>Rows</small><strong>{detail.original.rowCount.toLocaleString("en-IN")}</strong></span>
                  <span><small>Extraction</small><strong>{detail.status === "ready" ? "Ready" : "Review mapping"}</strong></span>
                  {detail.anomalies.length ? <span className="meta-warning"><AlertTriangle size={15} />{detail.anomalies.length} extraction issue{detail.anomalies.length === 1 ? "" : "s"}</span> : null}
                  <button className="button button-secondary" onClick={() => onMap(detail.id)}><FileCog size={15} />Modify mapping</button>
                </div>
                {!detail.original.rows.length ? <div className="empty-state"><FileSearch size={24} /><strong>No extractable rows</strong><p>Review the source or modify its mapping before reconciliation.</p></div> : (
                  <div className="table-scroll rows-table-scroll">
                    <table className="raw-data-table">
                      <thead><tr><th>#</th>{detail.original.fields.map((field) => <th key={field}>{field}</th>)}</tr></thead>
                      <tbody>{detail.original.rows.map((row, index) => (
                        <tr key={index}><td className="row-number">{index + 1}</td>{detail.original.fields.map((field) => {
                          const value = originalValue(row[field]);
                          return <td key={field} title={value}>{value}</td>;
                        })}</tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
