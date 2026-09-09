import { useEffect, useMemo, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { documentsApi, errorMessage, reconciliationApi } from "../api/client.js";
import DocumentLibrary from "../components/DocumentLibrary.jsx";
import DocumentTabs from "../components/DocumentTabs.jsx";
import MappingPanel from "../components/MappingPanel.jsx";
import Notice from "../components/Notice.jsx";
import ReconciliationControls from "../components/ReconciliationControls.jsx";
import TopNav from "../components/TopNav.jsx";
import UploadPanel from "../components/UploadPanel.jsx";
import { crossExamineClientGstins } from "../utils/gstinCrossExamination.js";

export default function WorkspacePage() {
  const navigate = useNavigate();
  const mappingMatch = useMatch("/home/mapping/:documentId");
  const [documents, setDocuments] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [details, setDetails] = useState({});
  const [originalDetails, setOriginalDetails] = useState({});
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [notice, setNotice] = useState(null);
  const [tolerances, setTolerances] = useState({ amountTolerance: 1, dateToleranceDays: 0 });

  useEffect(() => {
    documentsApi.list()
      .then((response) => setDocuments(response.data.documents))
      .catch((error) => setNotice({ tone: "danger", title: "Home could not load", message: errorMessage(error) }))
      .finally(() => setLoading(false));
  }, []);

  const mappingDocumentId = mappingMatch?.params.documentId;
  useEffect(() => {
    if (!mappingDocumentId || details[mappingDocumentId]) return;
    setDetailLoading(true);
    documentsApi.get(mappingDocumentId)
      .then(({ data }) => {
        setDetails((current) => ({ ...current, [mappingDocumentId]: data.document }));
        setDocuments((current) => current.map((document) => document.id === mappingDocumentId
          ? { ...data.document, parsed: undefined }
          : document));
      })
      .catch((error) => setNotice({ tone: "danger", title: "Document could not load", message: errorMessage(error) }))
      .finally(() => setDetailLoading(false));
  }, [mappingDocumentId, details]);

  useEffect(() => {
    if (!activeId || originalDetails[activeId]) return;
    setDetailLoading(true);
    documentsApi.getOriginal(activeId)
      .then(({ data }) => setOriginalDetails((current) => ({ ...current, [activeId]: data.document })))
      .catch((error) => setNotice({ tone: "danger", title: "Original document could not load", message: errorMessage(error) }))
      .finally(() => setDetailLoading(false));
  }, [activeId, originalDetails]);

  const selectedDocuments = useMemo(() => selectedIds.map((id) => documents.find((document) => document.id === id)).filter(Boolean), [selectedIds, documents]);
  const crossExamination = useMemo(() => crossExamineClientGstins(selectedDocuments), [selectedDocuments]);
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

  const toggleAllDocuments = (shouldSelect) => {
    const next = shouldSelect ? documents.map((document) => document.id) : [];
    setSelectedIds(next);
    setActiveId(next[0] || null);
  };

  const removeDocumentsFromWorkspace = (documentIds) => {
    const removed = new Set(documentIds);
    const remainingSelectedIds = selectedIds.filter((id) => !removed.has(id));
    setDocuments((current) => current.filter((document) => !removed.has(document.id)));
    setSelectedIds((current) => current.filter((id) => !removed.has(id)));
    setActiveId((current) => removed.has(current) ? remainingSelectedIds[0] || null : current);
    setDetails((current) => {
      const next = { ...current };
      for (const id of removed) delete next[id];
      return next;
    });
    setOriginalDetails((current) => {
      const next = { ...current };
      for (const id of removed) delete next[id];
      return next;
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
      console.log(error.response.data.error);
      setNotice({ tone: "danger", title: "Upload failed", message: errorMessage(error) });
    } finally { setUploading(false); setUploadProgress(0); }
  };

  const run = async () => {
    if (crossExamination.status === "unverified") {
      setNotice({ tone: "danger", title: "Client GSTIN required", message: "Map or correct the client GSTIN on at least one selected document before reconciliation." });
      return;
    }
    if (crossExamination.status === "mismatch") {
      setNotice({ tone: "danger", title: "Client GSTIN mismatch", message: "Remove unrelated documents or correct their client GSTIN mappings before reconciliation." });
      return;
    }
    setRunning(true); setNotice(null);
    try {
      const documentIds = selectedDocuments.map((document) => document.id);
      const { data } = await reconciliationApi.run({ documentIds, amountTolerance: Number(tolerances.amountTolerance), dateToleranceDays: Number(tolerances.dateToleranceDays) });
      const params = new URLSearchParams();
      const gstin = data.reconciliation.result?.clientGstin;
      const years = (data.reconciliation.result?.periods || [])
        .map((item) => item.returnPeriod?.slice(2))
        .filter((year) => /^\d{4}$/.test(year || ""))
        .sort((left, right) => right.localeCompare(left));
      if (gstin) params.set("gstin", gstin);
      if (years[0]) params.set("year", years[0]);
      const query = params.toString();
      navigate(`/reconciliations${query ? `?${query}` : ""}`);
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
      navigate("/home");
      setNotice({ tone: "success", title: "Mapping saved", message: "Normalized rows and active reconciliation exceptions were recalculated." });
    } finally { setSavingMapping(false); }
  };

  const deleteUploadedDocument = async (document) => {
    if (!window.confirm(`Delete ${document.originalName}? This will permanently remove the uploaded file.`)) return;
    setDeletingId(document.id);
    setNotice(null);
    try {
      await documentsApi.remove(document.id);
      removeDocumentsFromWorkspace([document.id]);
      setNotice({ tone: "success", title: "Document deleted", message: `${document.originalName} was removed from the workspace and server storage.` });
    } catch (error) {
      setNotice({ tone: "danger", title: "Document could not be deleted", message: errorMessage(error) });
    } finally {
      setDeletingId(null);
    }
  };

  const deleteSelectedDocuments = async () => {
    const documentIds = [...selectedIds];
    if (!documentIds.length) return;
    const noun = documentIds.length === 1 ? "file" : "files";
    if (!window.confirm(`Delete ${documentIds.length} selected ${noun}? This will permanently remove the uploaded ${noun}.`)) return;
    setBulkDeleting(true);
    setNotice(null);
    try {
      const { data } = await documentsApi.removeMany(documentIds);
      removeDocumentsFromWorkspace(data.deletedIds);
      if (data.errors.length) {
        setNotice({ tone: "warning", title: `${data.deletedIds.length} deleted; ${data.errors.length} could not be deleted`, message: "Files that could not be removed remain selected so you can retry." });
      } else {
        setNotice({ tone: "success", title: `${data.deletedIds.length} ${data.deletedIds.length === 1 ? "document" : "documents"} deleted`, message: "The selected files were removed from the workspace and server storage." });
      }
    } catch (error) {
      setNotice({ tone: "danger", title: "Selected documents could not be deleted", message: errorMessage(error) });
    } finally {
      setBulkDeleting(false);
    }
  };

  if (mappingMatch) return <MappingPanel document={details[mappingMatch.params.documentId]} onClose={() => navigate("/home")} onSave={saveMapping} saving={savingMapping} />;

  return (
    <div className="workspace-shell">
      <TopNav />
      <main className="workspace" id="workspace">
        <header className="page-header"><div><p className="eyebrow">Auditor home</p><h1>Reconciliation workspace</h1><p>Upload books and returns, verify extracted fields, then compare outward liability and input tax credit.</p></div></header>
        {notice ? <Notice tone={notice.tone} title={notice.title} onClose={() => setNotice(null)}>{notice.message}</Notice> : null}
        {loading ? <div className="panel loading-block"><span className="spinner" />Loading documents…</div> : (
          <>
            <UploadPanel onUpload={upload} uploading={uploading} progress={uploadProgress} />
            <DocumentLibrary documents={documents} selectedIds={selectedIds} onToggle={toggleSelection} onToggleAll={toggleAllDocuments} onMap={(id) => navigate(`/home/mapping/${id}`)} onDelete={deleteUploadedDocument} onDeleteSelected={deleteSelectedDocuments} deletingId={deletingId} bulkDeleting={bulkDeleting} />
            <ReconciliationControls selectedCount={selectedDocuments.length} crossExamination={crossExamination} values={tolerances} onChange={(event) => setTolerances((current) => ({ ...current, [event.target.name]: event.target.value }))} onRun={run} running={running} />
            <DocumentTabs selectedDocuments={selectedDocuments} activeId={activeId} onActive={setActiveId} onRemove={toggleSelection} onMap={(id) => navigate(`/home/mapping/${id}`)} detail={originalDetails[activeId]} loading={detailLoading} />
          </>
        )}
      </main>
    </div>
  );
}
