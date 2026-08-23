import { useEffect, useMemo, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { documentsApi, errorMessage, reconciliationApi } from "../api/client.js";
import DocumentLibrary from "../components/DocumentLibrary.jsx";
import DocumentTabs from "../components/DocumentTabs.jsx";
import MappingPanel from "../components/MappingPanel.jsx";
import Notice from "../components/Notice.jsx";
import ReconciliationControls from "../components/ReconciliationControls.jsx";
import ReconciliationResults from "../components/ReconciliationResults.jsx";
import TopNav from "../components/TopNav.jsx";
import UploadPanel from "../components/UploadPanel.jsx";

export default function WorkspacePage() {
  const navigate = useNavigate();
  const mappingMatch = useMatch("/workspace/mapping/:documentId");
  const [documents, setDocuments] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [details, setDetails] = useState({});
  const [latest, setLatest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);
  const [savingViewDecision, setSavingViewDecision] = useState(false);
  const [notice, setNotice] = useState(null);
  const [tolerances, setTolerances] = useState({ amountTolerance: 1, dateToleranceDays: 0 });

  useEffect(() => {
    Promise.all([documentsApi.list(), reconciliationApi.list()])
      .then(([documentResponse, reconciliationResponse]) => {
        setDocuments(documentResponse.data.documents);
        setLatest(reconciliationResponse.data.reconciliations[0] || null);
      })
      .catch((error) => setNotice({ tone: "danger", title: "Workspace could not load", message: errorMessage(error) }))
      .finally(() => setLoading(false));
  }, []);

  const requestedDetailId = mappingMatch?.params.documentId || activeId;
  useEffect(() => {
    if (!requestedDetailId || details[requestedDetailId]) return;
    setDetailLoading(true);
    documentsApi.get(requestedDetailId)
      .then(({ data }) => setDetails((current) => ({ ...current, [requestedDetailId]: data.document })))
      .catch((error) => setNotice({ tone: "danger", title: "Document could not load", message: errorMessage(error) }))
      .finally(() => setDetailLoading(false));
  }, [requestedDetailId, details]);

  const selectedDocuments = useMemo(() => selectedIds.map((id) => documents.find((document) => document.id === id)).filter(Boolean), [selectedIds, documents]);
  const toggleSelection = (id) => {
    setSelectedIds((current) => {
      if (current.includes(id)) {
        const next = current.filter((value) => value !== id);
        if (activeId === id) setActiveId(next[0] || null);
        return next;
      }
      if (!activeId) setActiveId(id);
      return [...current, id];
    });
  };

  const upload = async (files) => {
    setUploading(true); setUploadProgress(5); setNotice(null);
    try {
      const { data } = await documentsApi.upload(files, (event) => setUploadProgress(event.total ? Math.round((event.loaded / event.total) * 90) : 40));
      setUploadProgress(100);
      setDocuments((current) => [...data.documents, ...current]);
      const uploadedIds = data.documents.map((document) => document.id);
      setSelectedIds((current) => [...uploadedIds, ...current.filter((id) => !uploadedIds.includes(id))]);
      if (uploadedIds[0]) setActiveId(uploadedIds[0]);
      const needsMapping = data.documents.filter((document) => document.status === "needs_mapping").length;
      if (data.errors.length) setNotice({ tone: "warning", title: `${data.documents.length} file(s) added; ${data.errors.length} failed`, message: data.errors.map((item) => `${item.filename}: ${item.message}`).join(" ") });
      else if (needsMapping) setNotice({ tone: "warning", title: `${data.documents.length} document${data.documents.length === 1 ? "" : "s"} extracted; mapping review required`, message: "Choose whether to render unmatched source fields as extracted, keep the table hidden, or modify the mapping." });
      else setNotice({ tone: "success", title: `${data.documents.length} document${data.documents.length === 1 ? "" : "s"} ready`, message: "Return identity and structured rows were extracted on the server." });
    } catch (error) {
      setNotice({ tone: "danger", title: "Upload failed", message: errorMessage(error) });
    } finally { setUploading(false); setUploadProgress(0); }
  };

  const run = async () => {
    setRunning(true); setNotice(null);
    try {
      const { data } = await reconciliationApi.run({ documentIds: selectedIds, amountTolerance: Number(tolerances.amountTolerance), dateToleranceDays: Number(tolerances.dateToleranceDays) });
      setLatest(data.reconciliation);
      setNotice({ tone: data.reconciliation.status === "matched" ? "success" : "warning", title: data.reconciliation.status === "matched" ? "Reconciliation matched" : "Reconciliation needs review", message: data.reconciliation.status === "matched" ? "All comparison values are within tolerance." : "Review the highlighted differences and suggested mapping changes below." });
      requestAnimationFrame(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (error) {
      setNotice({ tone: "danger", title: "Reconciliation could not run", message: errorMessage(error) });
    } finally { setRunning(false); }
  };

  const saveMapping = async (mapping) => {
    const id = mappingMatch.params.documentId;
    setSavingMapping(true);
    try {
      const { data } = await documentsApi.updateMapping(id, mapping);
      setDetails((current) => ({ ...current, [id]: data.document }));
      setDocuments((current) => current.map((document) => document.id === id ? { ...data.document, parsed: undefined } : document));
      navigate("/workspace");
      setNotice({ tone: "success", title: "Mapping saved", message: "Normalized rows and anomaly checks were recalculated." });
    } finally { setSavingMapping(false); }
  };

  const saveViewPreference = async (id, mode) => {
    setSavingViewDecision(true);
    try {
      const { data } = await documentsApi.updateViewPreference(id, mode);
      setDetails((current) => ({ ...current, [id]: data.document }));
    } catch (error) {
      setNotice({ tone: "danger", title: "Document view preference was not saved", message: errorMessage(error) });
    } finally { setSavingViewDecision(false); }
  };

  if (mappingMatch) return <MappingPanel document={details[mappingMatch.params.documentId]} onClose={() => navigate("/workspace")} onSave={saveMapping} saving={savingMapping} />;

  return (
    <div className="workspace-shell">
      <TopNav />
      <main className="workspace" id="workspace">
        <header className="page-header"><div><p className="eyebrow">Auditor workspace</p><h1>GST return reconciliation</h1><p>Upload returns, verify extracted fields, then compare outward liability and input tax credit.</p></div><div className="page-context"><small>Review mode</small><strong>GSTR-1 ↔ GSTR-3B</strong><span>Optional GSTR-2B ITC check</span></div></header>
        {notice ? <Notice tone={notice.tone} title={notice.title} onClose={() => setNotice(null)}>{notice.message}</Notice> : null}
        {loading ? <div className="panel loading-block"><span className="spinner" />Loading documents…</div> : (
          <>
            <UploadPanel onUpload={upload} uploading={uploading} progress={uploadProgress} />
            <DocumentLibrary documents={documents} selectedIds={selectedIds} onToggle={toggleSelection} onMap={(id) => navigate(`/workspace/mapping/${id}`)} />
            <ReconciliationControls selectedCount={selectedIds.length} values={tolerances} onChange={(event) => setTolerances((current) => ({ ...current, [event.target.name]: event.target.value }))} onRun={run} running={running} />
            <DocumentTabs selectedDocuments={selectedDocuments} activeId={activeId} onActive={setActiveId} onRemove={toggleSelection} onMap={(id) => navigate(`/workspace/mapping/${id}`)} onViewDecision={saveViewPreference} decisionSaving={savingViewDecision} detail={details[activeId]} loading={detailLoading} />
            <ReconciliationResults reconciliation={latest} onModifyMapping={(id) => navigate(`/workspace/mapping/${id}`)} />
          </>
        )}
      </main>
      <footer className="workspace-footer"><span>Reconcile GST</span><span>Audit support only · Source returns are never modified</span></footer>
    </div>
  );
}
