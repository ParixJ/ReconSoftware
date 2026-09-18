import { useEffect, useMemo, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { documentsApi, errorMessage, reconciliationApi } from "../api/client.js";
import DocumentLibrary from "../components/DocumentLibrary.jsx";
import DocumentTabs from "../components/DocumentTabs.jsx";
import MappingPanel from "../components/MappingPanel.jsx";
import Notice from "../components/Notice.jsx";
import ReconciliationControls from "../components/ReconciliationControls.jsx";
import TopNav from "../components/TopNav.jsx";
import UploadPanel from "../components/UploadPanel.jsx";
import { crossExamineClientGstins } from "../utils/gstinCrossExamination.js";
import {useDocStore} from '../store/docStore.js';

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function yearFromReturnPeriod(returnPeriod) {
  return String(returnPeriod || "").match(/^(?:0[1-9]|1[0-2])(\d{4})/)?.[1] || null;
}

export default function WorkspacePage() {
  const navigate = useNavigate();
  const mappingMatch = useMatch("/home/mapping/:documentId");
  const [documents, setDocuments] = [useDocStore((s)=>s.documents), useDocStore((s)=>s.setDocuments)];
  const [selectedIds, setSelectedIds] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [details, setDetails] = useState(new Map());
  const [originalDetails, setOriginalDetails] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [savingMapping, setSavingMapping] = useState(false);
  const [applyingGstin, setApplyingGstin] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [notice, setNotice] = useState(null);
  const [tolerances, setTolerances] = useState({ amountTolerance: 1, dateToleranceDays: 0 });
  const [bulkGstin, setBulkGstin] = useState("");

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
      else if (needsMapping) setNotice({ tone: "warning", title: `${data.documents.length} document${data.documents.length === 1 ? "" : "s"} extracted; mapping review required`, message: "Original source fields remain visible below. Review the unmatched mapping before reconciliation." });
      else setNotice({ tone: "success", title: `${data.documents.length} document${data.documents.length === 1 ? "" : "s"} ready`, message: "Return identity and structured rows were extracted on the server." });
    } catch (error) {
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
        .map((item) => yearFromReturnPeriod(item.returnPeriod))
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

  const applyGstinToSelected = async () => {
    const gstin = bulkGstin.trim().toUpperCase();
    if (!selectedIds.length) {
      setNotice({ tone: "danger", title: "No documents selected", message: "Select one or more documents before applying a client GSTIN." });
      return;
    }
    if (!GSTIN_PATTERN.test(gstin)) {
      setNotice({ tone: "danger", title: "Invalid GSTIN", message: "Enter a valid 15-character GSTIN before applying it to selected documents." });
      return;
    }

    setApplyingGstin(true);
    setNotice(null);
    try {
      const { data } = await documentsApi.updateGstin(selectedIds, gstin);
      const updatedById = new Map(data.documents.map((document) => [document.id, document]));
      setDocuments((current) => current.map((document) => (
        updatedById.has(document.id) ? { ...updatedById.get(document.id), parsed: undefined } : document
      )));
      setDetails((current) => {
        const next = { ...current };
        for (const document of data.documents) {
          if (next[document.id]) next[document.id] = document;
        }
        return next;
      });
      setBulkGstin(gstin);
      setNotice({ tone: "success", title: "GSTIN applied", message: `${data.documents.length} selected document${data.documents.length === 1 ? "" : "s"} now use ${gstin}.` });
    } catch (error) {
      setNotice({ tone: "danger", title: "GSTIN could not be applied", message: errorMessage(error) });
    } finally {
      setApplyingGstin(false);
    }
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

  const deleteUploadedDocument = async () => {
    const document = deleteTarget;
    if (!document) return;
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
      setDeleteTarget(null);
    }
  };

  const deleteSelectedDocuments = async () => {
    const documentIds = [...selectedIds];
    if (!documentIds.length) return;
    setBulkDeleting(true);
    setBulkDeleteOpen(false);
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
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-6 sm:px-6 lg:px-8" id="workspace">
        <header className="border-b border-border pb-5"><p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Auditor home</p><h1 className="mt-1 text-2xl">Reconciliation workspace</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">Upload books and returns, verify extracted fields, then compare outward liability and input tax credit.</p></header>
        {notice ? <Notice tone={notice.tone} title={notice.title} onClose={() => setNotice(null)}>{notice.message}</Notice> : null}
        {loading ? <Card><CardContent className="flex min-h-36 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner label="Loading documents" />Loading documents…</CardContent></Card> : (
          <>
            <UploadPanel onUpload={upload} uploading={uploading} progress={uploadProgress} />
            <DocumentLibrary documents={documents} selectedIds={selectedIds} onToggle={toggleSelection} onToggleAll={toggleAllDocuments} onMap={(id) => navigate(`/home/mapping/${id}`)} onDelete={setDeleteTarget} onDeleteSelected={() => setBulkDeleteOpen(true)} deletingId={deletingId} bulkDeleting={bulkDeleting} />
            <ReconciliationControls selectedCount={selectedDocuments.length} crossExamination={crossExamination} values={tolerances} gstinValue={bulkGstin} onChange={(event) => setTolerances((current) => ({ ...current, [event.target.name]: event.target.value }))} onGstinChange={(event) => setBulkGstin(event.target.value.toUpperCase())} onApplyGstin={applyGstinToSelected} onRun={run} running={running} applyingGstin={applyingGstin} />
            <DocumentTabs selectedDocuments={selectedDocuments} activeId={activeId} onActive={setActiveId} onRemove={toggleSelection} onMap={(id) => navigate(`/home/mapping/${id}`)} detail={originalDetails[activeId]} loading={detailLoading} />
          </>
        )}
      </main>
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open && !deletingId) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>{deleteTarget ? `Delete ${deleteTarget.originalName}? This will permanently remove the uploaded file.` : "This will permanently remove the uploaded file."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(deletingId)}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={deleteUploadedDocument} disabled={Boolean(deletingId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={bulkDeleteOpen} onOpenChange={(open) => { if (!bulkDeleting) setBulkDeleteOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected documents?</AlertDialogTitle>
            <AlertDialogDescription>Delete {selectedIds.length} selected {selectedIds.length === 1 ? "file" : "files"}? This will permanently remove the uploaded {selectedIds.length === 1 ? "file" : "files"}.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={deleteSelectedDocuments} disabled={bulkDeleting || !selectedIds.length}>Delete selected</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
