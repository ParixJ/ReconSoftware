import { AlertTriangle, FileSearch, LoaderCircle, X } from "lucide-react";
import { TYPE_LABELS, money } from "../utils/format.js";
import DocumentRenderGate from "./DocumentRenderGate.jsx";

export default function DocumentTabs({ selectedDocuments, activeId, onActive, onRemove, onMap, onViewDecision, decisionSaving, detail, loading }) {
  return (
    <section className="panel viewer-panel" aria-labelledby="viewer-heading">
      <div className="section-heading viewer-heading"><div><p className="eyebrow">Document browser</p><h2 id="viewer-heading">Return document data</h2><p>Mapped returns use the fixed audit schema; incomplete mappings require a rendering choice.</p></div></div>
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
                  <span><small>Rows</small><strong>{detail.recordCount.toLocaleString("en-IN")}</strong></span>
                  <span><small>Extraction</small><strong>{detail.status === "ready" ? "Ready" : "Review mapping"}</strong></span>
                  {detail.anomalies.length ? <span className="meta-warning"><AlertTriangle size={15} />{detail.anomalies.length} extraction issue{detail.anomalies.length === 1 ? "" : "s"}</span> : null}
                </div>
                {detail.mappingCoverage?.viewMode !== "normalized" ? (
                  <DocumentRenderGate detail={detail} onDecision={(mode) => onViewDecision(detail.id, mode)} onMap={() => onMap(detail.id)} saving={decisionSaving} />
                ) : !detail.parsed.rows.length ? <div className="empty-state"><FileSearch size={24} /><strong>No structured rows</strong><p>Review the source and Modify mapping before reconciliation.</p></div> : (
                  <div className="table-scroll rows-table-scroll">
                    <table className="data-table">
                      <thead><tr><th>#</th><th>Section</th><th>Counterparty GSTIN</th><th>Trade name</th><th>Invoice / document</th><th>Date</th><th>PoS</th><th className="number-cell">Invoice value</th><th className="number-cell">Taxable value</th><th className="number-cell">IGST</th><th className="number-cell">CGST</th><th className="number-cell">SGST</th><th className="number-cell">Cess</th></tr></thead>
                      <tbody>{detail.parsed.rows.map((row, index) => (
                        <tr key={`${row.invoiceNumber || row.section}-${index}`}>
                          <td className="row-number">{index + 1}</td><td><span className="section-code">{row.section || "—"}</span></td><td className="mono">{row.counterpartyGstin || "—"}</td><td>{row.tradeName || "—"}</td><td>{row.invoiceNumber || "—"}</td><td className="mono">{row.invoiceDate || "—"}</td><td>{row.placeOfSupply || "—"}</td><td className="number-cell">{money(row.invoiceValue)}</td><td className="number-cell">{money(row.taxableValue)}</td><td className="number-cell">{money(row.igst)}</td><td className="number-cell">{money(row.cgst)}</td><td className="number-cell">{money(row.sgst)}</td><td className="number-cell">{money(row.cess)}</td>
                        </tr>
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
