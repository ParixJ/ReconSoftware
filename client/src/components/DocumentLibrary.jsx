import { useEffect, useRef } from "react";
import { AlertTriangle, Check, FileCog, FileJson2, FileSpreadsheet, FileText, Inbox, Minus, Trash2 } from "lucide-react";
import { TYPE_LABELS, dateTime, period } from "../utils/format.js";

const fileIcons = { json: FileJson2, xlsx: FileSpreadsheet, csv: FileSpreadsheet, pdf: FileText };

export default function DocumentLibrary({ documents, selectedIds, onToggle, onToggleAll, onMap, onDelete, onDeleteSelected, deletingId, bulkDeleting }) {
  const selectAllRef = useRef(null);
  const selectedCount = documents.filter((document) => selectedIds.includes(document.id)).length;
  const allSelected = documents.length > 0 && selectedCount === documents.length;
  const partiallySelected = selectedCount > 0 && !allSelected;
  const deleting = Boolean(deletingId) || bulkDeleting;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = partiallySelected;
  }, [partiallySelected]);

  return (
    <section className="panel document-panel" id="documents" aria-labelledby="documents-heading">
      <div className="section-heading">
        <div><p className="eyebrow">Step 2</p><h2 id="documents-heading">Select files</h2><p>Use the selected files for reconciliation or delete them together. At least one GSTR-1 and one GSTR-3B are required for reconciliation.</p></div>
        <div className="selection-actions">
          <span className="count-badge">{selectedCount} selected</span>
          <button className="button button-secondary button-danger" onClick={onDeleteSelected} disabled={!selectedCount || deleting}>
            <Trash2 size={15} />{bulkDeleting ? "Deleting selected…" : `Delete selected${selectedCount ? ` (${selectedCount})` : ""}`}
          </button>
        </div>
      </div>
      {!documents.length ? (
        <div className="empty-state"><Inbox size={28} /><strong>No documents uploaded</strong><p>Add GST return files above to begin.</p></div>
      ) : (
        <div className="table-scroll document-table-scroll">
          <table>
            <thead><tr><th className="check-cell"><label className="checkbox"><input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={() => onToggleAll(!allSelected)} disabled={deleting} aria-label={allSelected ? "Clear document selection" : "Select all documents"} /><span>{partiallySelected ? <Minus size={13} /> : <Check size={13} />}</span></label></th><th>Document</th><th>Return</th><th>Client GSTIN</th><th>Period</th><th className="number-cell">Records</th><th>Review state</th><th>Uploaded</th><th className="action-cell">Action</th></tr></thead>
            <tbody>
              {documents.map((document) => {
                const Icon = fileIcons[document.fileType] || FileText;
                const selected = selectedIds.includes(document.id);
                const issues = document.anomalies?.length || 0;
                return (
                  <tr key={document.id} className={selected ? "row-selected" : ""}>
                    <td className="check-cell"><label className="checkbox"><input type="checkbox" checked={selected} onChange={() => onToggle(document.id)} disabled={deleting} aria-label={`Select ${document.originalName}`} /><span><Check size={13} /></span></label></td>
                    <td><div className="document-name"><span className={`file-icon file-${document.fileType}`}><Icon size={17} /></span><span><strong title={document.originalName}>{document.originalName}</strong><small>{document.fileType.toUpperCase()}</small></span></div></td>
                    <td><span className={`type-pill type-${document.documentType}`}>{TYPE_LABELS[document.documentType]}</span></td>
                    <td className="mono">{document.gstin || <span className="missing-text">Not detected</span>}</td>
                    <td>{period(document.returnPeriod)}</td>
                    <td className="number-cell">{document.recordCount.toLocaleString("en-IN")}</td>
                    <td>{issues ? <span className="status-pill status-warning"><AlertTriangle size={13} />{issues} {issues === 1 ? "issue" : "issues"}</span> : <span className="status-pill status-success"><Check size={13} />Ready</span>}</td>
                    <td><span className="muted-cell">{dateTime(document.createdAt)}</span></td>
                    <td className="action-cell">
                      <div className="document-actions">
                        <button className="text-button" onClick={() => onMap(document.id)} disabled={deleting}><FileCog size={15} />Modify mapping</button>
                        <button className="text-button text-button-danger" onClick={() => onDelete(document)} disabled={deleting} aria-label={`Delete ${document.originalName}`}><Trash2 size={15} />{deletingId === document.id ? "Deleting…" : "Delete"}</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
