import { useRef, useState } from "react";
import { FileJson2, FileSpreadsheet, FileText, UploadCloud } from "lucide-react";

export default function UploadPanel({ onUpload, uploading, progress }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const choose = (files) => { if (files?.length) onUpload(files); };

  return (
    <section className="panel upload-panel" aria-labelledby="upload-heading">
      <div className="section-heading compact-heading">
        <div><h2 id="upload-heading">Add return documents</h2></div>
        <span className="section-helper">Up to 10 files · 20 MB each</span>
      </div>
      <div
        className={`dropzone ${dragging ? "dropzone-active" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files); }}
      >
        <input ref={inputRef} className="visually-hidden" type="file" multiple accept=".pdf,.xlsx,.csv,.json,application/pdf,application/json" onChange={(event) => { choose(event.target.files); event.target.value = ""; }} />
        <span className="upload-icon"><UploadCloud size={24} /></span>
        <div><strong>{uploading ? `Uploading and extracting… ${progress}%` : "Drop GST returns or sales registers here"}</strong><p>File format and document type are detected automatically</p></div>
        <button className="button button-secondary" type="button" onClick={() => inputRef.current?.click()} disabled={uploading}>{uploading ? "Processing" : "Browse files"}</button>
      </div>
      {uploading ? <div className="progress-track" aria-label={`Upload ${progress}% complete`}><span style={{ width: `${progress}%` }} /></div> : null}
      <div className="format-list" aria-label="Supported formats">
        <span><FileText size={15} />PDF</span><span><FileSpreadsheet size={15} />XLSX</span><span><FileSpreadsheet size={15} />CSV</span><span><FileJson2 size={15} />JSON</span>
      </div>
    </section>
  );
}

