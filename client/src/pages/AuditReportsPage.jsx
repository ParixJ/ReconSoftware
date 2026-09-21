import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileSearch, Plus, RefreshCw, Upload } from "lucide-react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "../api/client.js";
import { AUDIT_CHECKS, REVIEW_DECISIONS, SOURCE_ROLES, isTerminalRun, latestReviewFor, parsedFields, parsedRows, scrutinyApi } from "../api/scrutiny.js";
import Notice from "../components/Notice.jsx";
import TopNav from "../components/TopNav.jsx";

const roleLabel = Object.fromEntries(SOURCE_ROLES);
const checkLabel = Object.fromEntries(AUDIT_CHECKS);
const decisionLabel = Object.fromEntries(REVIEW_DECISIONS);
const DocumentGrid = lazy(() => import("../components/DocumentGrid.jsx"));

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function statusTone(status) {
  if (status === "completed" || status === "ready" || status === "matched") return "text-success";
  if (status === "failed") return "text-destructive";
  if (status === "difference" || status === "review" || status === "insufficient_data") return "text-warning";
  return "text-info";
}

function Status({ value }) {
  return <span className={`font-medium ${statusTone(value)}`}>{String(value || "Unknown").replaceAll("_", " ")}</span>;
}

function PanelLoading({ label }) {
  return <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner label={label} />{label}…</div>;
}

function ReportList() {
  const navigate = useNavigate();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [fiscalYear, setFiscalYear] = useState("");
  const [taxpayerId, setTaxpayerId] = useState("");

  useEffect(() => {
    let active = true;
    scrutinyApi.listReports()
      .then(({ data }) => { if (active) setReports(data.auditReports || []); })
      .catch((requestError) => { if (active) setError(errorMessage(requestError, "Audit reports could not load.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function createReport(event) {
    event.preventDefault();
    setCreateError("");
    const match = /^(\d{4})-(\d{4})$/.exec(fiscalYear.trim());
    if (!match || Number(match[2]) !== Number(match[1]) + 1) {
      setCreateError("Enter a consecutive fiscal year, for example 2024-2025.");
      return;
    }
    setCreating(true);
    try {
      const { data } = await scrutinyApi.createReport({ name, fiscalYear, taxpayerId });
      navigate(`/scrutiny/audit-reports/${encodeURIComponent(data.auditReport.id)}`);
    } catch (requestError) {
      setCreateError(errorMessage(requestError, "Audit report could not be created."));
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="border-b border-border pb-5">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Scrutiny</p>
        <h1 className="mt-1 text-2xl">Audit reports</h1>
        <p className="mt-2 text-sm text-muted-foreground">Collect source evidence, run selected checks, and record reviewer decisions.</p>
      </header>
      <div className="grid gap-6 xl:grid-cols-[minmax(280px,380px)_minmax(0,1fr)]">
        <Card className="self-start border border-border" aria-labelledby="create-report-heading">
          <CardHeader><CardTitle id="create-report-heading" className="text-lg">Create a report</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={createReport}>
              <div className="space-y-2"><Label htmlFor="audit-name">Report name</Label><Input id="audit-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={160} required /></div>
              <div className="space-y-2"><Label htmlFor="audit-year">Fiscal year</Label><Input id="audit-year" value={fiscalYear} onChange={(event) => setFiscalYear(event.target.value)} placeholder="2024-2025" inputMode="numeric" pattern="[0-9]{4}-[0-9]{4}" required /></div>
              <div className="space-y-2"><Label htmlFor="audit-taxpayer">Taxpayer ID (optional)</Label><Input id="audit-taxpayer" value={taxpayerId} onChange={(event) => setTaxpayerId(event.target.value)} maxLength={32} autoCapitalize="characters" /></div>
              {createError ? <Notice tone="danger" title="Could not create report">{createError}</Notice> : null}
              <Button type="submit" disabled={creating || !name.trim()}><Plus aria-hidden="true" />{creating ? "Creating…" : "Create report"}</Button>
            </form>
          </CardContent>
        </Card>
        <Card className="border border-border" aria-labelledby="saved-reports-heading">
          <CardHeader><CardTitle id="saved-reports-heading" className="text-lg">Saved reports</CardTitle></CardHeader>
          <CardContent>
            {loading ? <PanelLoading label="Loading audit reports" /> : null}
            {error ? <Notice tone="danger" title="Reports could not load">{error}</Notice> : null}
            {!loading && !error && !reports.length ? <p className="py-8 text-center text-sm text-muted-foreground">No audit reports yet. Create one to begin.</p> : null}
            {!loading && !error && reports.length ? (
              <Table><TableHeader><TableRow><TableHead>Report</TableHead><TableHead>Fiscal year</TableHead><TableHead className="hidden sm:table-cell">Updated</TableHead><TableHead><span className="sr-only">Open</span></TableHead></TableRow></TableHeader>
                <TableBody>{reports.map((report) => <TableRow key={report.id}><TableCell><Link className="font-medium underline-offset-2 hover:underline" to={`/scrutiny/audit-reports/${encodeURIComponent(report.id)}`}>{report.name}</Link>{report.taxpayerId ? <span className="block text-xs text-muted-foreground">{report.taxpayerId}</span> : null}</TableCell><TableCell className="tabular-nums">{report.fiscalYear}</TableCell><TableCell className="hidden text-muted-foreground sm:table-cell">{formatDate(report.updatedAt)}</TableCell><TableCell><Button asChild variant="ghost" size="sm"><Link to={`/scrutiny/audit-reports/${encodeURIComponent(report.id)}`}>Open</Link></Button></TableCell></TableRow>)}</TableBody>
              </Table>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function SourceDetail({ reportId, source }) {
  const [detail, setDetail] = useState(source);
  const [error, setError] = useState("");
  const [fileError, setFileError] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileUrl, setFileUrl] = useState("");
  const [fileType, setFileType] = useState("");

  useEffect(() => {
    let active = true;
    setDetail(source);
    setError("");
    scrutinyApi.getSource(reportId, source.id)
      .then(({ data }) => { if (active) setDetail(data.source); })
      .catch((requestError) => { if (active) setError(errorMessage(requestError, "Source detail could not load.")); });
    return () => { active = false; };
  }, [reportId, source]);

  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);
  useEffect(() => { setFileUrl(""); setFileError(""); }, [source.id]);

  async function showOriginal() {
    setFileError("");
    setFileLoading(true);
    try {
      const { data } = await scrutinyApi.getSourceFile(reportId, source.id);
      setFileType(data.type || detail.mimeType || "application/octet-stream");
      setFileUrl(URL.createObjectURL(data));
    } catch (requestError) {
      setFileError(errorMessage(requestError, "Original file could not load."));
    } finally {
      setFileLoading(false);
    }
  }

  const rows = parsedRows(detail.parsed);
  const fields = parsedFields(detail.parsed);
  const issues = detail.parsed?.issues || detail.issues || [];
  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h4 className="break-all text-base">{detail.originalName}</h4><p className="text-xs text-muted-foreground">{roleLabel[detail.role] || detail.role} · <Status value={detail.parseStatus} /> · {detail.parsed?.recordCount ?? rows.length} parsed rows</p></div>
        <Button variant="outline" size="sm" onClick={showOriginal} disabled={fileLoading}>{fileLoading ? "Loading original…" : "View original file"}</Button>
      </div>
      {error ? <Notice tone="danger" title="Source detail unavailable">{error}</Notice> : null}
      {fileError ? <Notice tone="danger" title="File unavailable">{fileError}</Notice> : null}
      {detail.parseWarnings?.length ? <Notice tone="warning" title="Parse warnings"><ul className="list-disc pl-5">{detail.parseWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></Notice> : null}
      {issues.length ? <Notice tone="warning" title={`${issues.length} parsing issue${issues.length === 1 ? "" : "s"}`}><ul className="list-disc pl-5">{issues.map((issue, index) => <li key={`${issue.code || "issue"}-${index}`}>{issue.rowNumber ? `Row ${issue.rowNumber}: ` : ""}{issue.message || String(issue)}</li>)}</ul></Notice> : null}
      {fileUrl ? <div className="space-y-2"><a href={fileUrl} download={detail.originalName} className="text-sm underline">Download original file</a>{fileType.includes("pdf") ? <object data={fileUrl} type="application/pdf" className="h-[min(70vh,700px)] w-full border border-border" aria-label={`PDF evidence: ${detail.originalName}`}><p>PDF preview is unavailable. Use the download link above.</p></object> : null}</div> : null}
      {rows.length ? <div className="space-y-2"><h5 className="text-sm">Parsed source rows</h5><Suspense fallback={<PanelLoading label="Loading source rows" />}><DocumentGrid fields={fields} rows={rows} /></Suspense></div> : <p className="text-sm text-muted-foreground">No structured rows are available for this source. The original file remains available as evidence.</p>}
    </div>
  );
}

function SourcesPanel({ reportId, sources, onRefresh, selectedSourceIds, onSelectionChange, activeSourceId, onActiveSourceChange }) {
  const [file, setFile] = useState(null);
  const [role, setRole] = useState(SOURCE_ROLES[0][0]);
  const [completeExport, setCompleteExport] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const activeSource = sources.find((source) => source.id === activeSourceId);

  async function upload(event) {
    event.preventDefault();
    if (!file) return;
    const formElement = event.currentTarget;
    setError("");
    setUploading(true);
    let uploaded = false;
    try {
      const { data } = await scrutinyApi.uploadSource(reportId, file, role, completeExport);
      uploaded = true;
      setFile(null);
      setCompleteExport(false);
      formElement.reset();
      onActiveSourceChange(data.source.id);
      await onRefresh();
    } catch (requestError) {
      setError(errorMessage(requestError, uploaded ? "Source uploaded, but the report could not refresh. Use Refresh to reload it." : "Source could not be uploaded."));
    } finally {
      setUploading(false);
    }
  }

  function toggleSource(id) {
    onSelectionChange(selectedSourceIds.includes(id) ? selectedSourceIds.filter((item) => item !== id) : [...selectedSourceIds, id]);
  }

  return (
    <Card className="border border-border" aria-labelledby="sources-heading">
      <CardHeader><CardTitle id="sources-heading" className="text-lg">Source evidence</CardTitle><p className="text-sm text-muted-foreground">Upload one file at a time. Mark an export complete only when it covers the full intended period.</p></CardHeader>
      <CardContent className="space-y-5">
        <form className="grid gap-3 rounded-sm bg-muted/50 p-4 sm:grid-cols-2 xl:grid-cols-[minmax(160px,1fr)_minmax(200px,1fr)_auto]" onSubmit={upload}>
          <div className="space-y-2"><Label htmlFor="source-role">Source role</Label><select id="source-role" className="h-9 w-full rounded-sm border border-input bg-background px-3 text-sm" value={role} onChange={(event) => setRole(event.target.value)}>{SOURCE_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="source-file">File</Label><Input id="source-file" type="file" accept=".json,.csv,.xlsx,.pdf,application/json,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => setFile(event.target.files?.[0] || null)} required /></div>
          <div className="flex items-end"><Button type="submit" disabled={!file || uploading}><Upload aria-hidden="true" />{uploading ? "Uploading…" : "Upload source"}</Button></div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2 xl:col-span-3"><input type="checkbox" checked={completeExport} onChange={(event) => setCompleteExport(event.target.checked)} />Complete export for the period</label>
        </form>
        {error ? <Notice tone="danger" title="Upload failed">{error}</Notice> : null}
        {!sources.length ? <p className="text-sm text-muted-foreground">No sources uploaded yet.</p> : (
          <div className="space-y-1">{sources.map((source) => <div key={source.id} className="flex flex-wrap items-center gap-3 border-b border-border py-3 last:border-0">
            <label className="flex min-w-0 flex-1 items-center gap-3"><input type="checkbox" checked={selectedSourceIds.includes(source.id)} onChange={() => toggleSource(source.id)} aria-label={`Select ${source.originalName} for run`} /><span className="min-w-0"><span className="block truncate text-sm">{source.originalName}</span><span className="text-xs text-muted-foreground">{roleLabel[source.role] || source.role} · <Status value={source.parseStatus} /></span></span></label>
            <Button variant="ghost" size="sm" onClick={() => onActiveSourceChange(activeSourceId === source.id ? "" : source.id)} aria-expanded={activeSourceId === source.id}>{activeSourceId === source.id ? "Hide" : "Inspect"}</Button>
          </div>)}</div>
        )}
        {activeSource ? <SourceDetail reportId={reportId} source={activeSource} /> : null}
      </CardContent>
    </Card>
  );
}

function ReviewForm({ reportId, runId, result, review, onSaved }) {
  const [decision, setDecision] = useState(review?.decision || "needs_follow_up");
  const [note, setNote] = useState(review?.note || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setDecision(review?.decision || "needs_follow_up"); setNote(review?.note || ""); }, [review]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { data } = await scrutinyApi.setDecision(reportId, runId, result.id, decision, note);
      onSaved(data.review);
    } catch (requestError) {
      setError(errorMessage(requestError, "Reviewer decision could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  return <form className="flex flex-wrap items-end gap-3 border-t border-border pt-3" onSubmit={save}>
    <div className="min-w-40 space-y-1"><Label htmlFor={`decision-${result.id}`}>Decision</Label><select id={`decision-${result.id}`} className="h-9 w-full rounded-sm border border-input bg-background px-3 text-sm" value={decision} onChange={(event) => setDecision(event.target.value)}>{REVIEW_DECISIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
    <div className="min-w-48 flex-1 space-y-1"><Label htmlFor={`note-${result.id}`}>Reviewer note</Label><Input id={`note-${result.id}`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} /></div>
    <Button type="submit" variant="outline" disabled={saving}>{saving ? "Saving…" : review ? "Update decision" : "Save decision"}</Button>
    {error ? <p role="alert" className="w-full text-sm text-destructive">{error}</p> : null}
  </form>;
}

function RunResults({ reportId, run, results, reviews, sources, loading, error, onReviewSaved, onInspectSource }) {
  if (run.status === "failed") return <Notice tone="danger" title="Run failed">{run.error?.message || run.failure || "The selected checks could not complete."}</Notice>;
  if (run.status !== "completed") return <p role="status" className="text-sm text-muted-foreground">Run is <Status value={run.status} />. Results will appear when processing finishes.</p>;
  if (loading) return <PanelLoading label="Loading findings" />;
  if (error) return null;
  if (!results.length) return <p className="text-sm text-muted-foreground">This completed run has no results.</p>;
  return <div className="space-y-4">{results.map((result) => {
    const review = latestReviewFor(reviews, result.id);
    return <section key={result.id} className="space-y-3 border border-border bg-background p-4" aria-label={`${result.checkId} result`}>
      <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{result.checkId}</Badge><span className="text-sm text-muted-foreground">{checkLabel[result.checkId]}</span><Status value={result.status} /></div>
      <p className="text-sm">{result.summary}</p>
      {["expectedAmount", "actualAmount", "differenceAmount"].some((key) => result[key] != null) ? <dl className="grid gap-2 text-sm sm:grid-cols-3">{[["Expected", result.expectedAmount], ["Actual", result.actualAmount], ["Difference", result.differenceAmount]].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="tabular-nums">{value ?? "—"}</dd></div>)}</dl> : null}
      {result.evidence?.length ? <details className="text-sm"><summary className="cursor-pointer">Evidence ({result.evidence.length})</summary><ul className="mt-2 space-y-2">{result.evidence.map((item, index) => {
        const sourceIds = [...new Set([item.sourceId, ...(item.sourceRefs || []).map((ref) => ref.sourceId)].filter(Boolean))];
        return <li key={index} className="break-words border-l-2 border-border pl-3 text-muted-foreground"><pre className="whitespace-pre-wrap font-sans text-xs">{JSON.stringify(item, null, 2)}</pre>{sourceIds.map((id) => {
          const source = sources.find((candidate) => candidate.id === id);
          return source ? <button key={id} type="button" className="mr-3 mt-1 text-xs text-foreground underline" onClick={() => onInspectSource(id)}>Inspect {source.originalName}</button> : null;
        })}</li>;
      })}</ul></details> : null}
      {review ? <p className="text-xs text-muted-foreground">Current decision: {decisionLabel[review.decision] || review.decision}{review.createdAt ? ` · ${formatDate(review.createdAt)}` : ""}</p> : null}
      <ReviewForm reportId={reportId} runId={run.id} result={result} review={review} onSaved={onReviewSaved} />
    </section>;
  })}</div>;
}

function ReportDetail() {
  const { reportId } = useParams();
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSourceIds, setSelectedSourceIds] = useState([]);
  const [activeSourceId, setActiveSourceId] = useState("");
  const [checkIds, setCheckIds] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [run, setRun] = useState(null);
  const [results, setResults] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [runError, setRunError] = useState("");
  const [runRefreshError, setRunRefreshError] = useState("");
  const [resultsError, setResultsError] = useState("");
  const [running, setRunning] = useState(false);
  const [resultsReload, setResultsReload] = useState(0);

  const refresh = useCallback(async () => {
    const { data } = await scrutinyApi.getReport(reportId);
    setReportData(data);
    return data;
  }, [reportId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    scrutinyApi.getReport(reportId)
      .then(({ data }) => { if (active) { setReportData(data); setSelectedRunId(data.runs?.[0]?.id || ""); } })
      .catch((requestError) => { if (active) setError(errorMessage(requestError, "Audit report could not load.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reportId]);

  useEffect(() => {
    let active = true;
    let timer;
    setRun(null);
    setResults([]);
    setReviews([]);
    setResultsLoading(false);
    setRunError("");
    setResultsError("");
    if (!selectedRunId) return () => { active = false; };
    const poll = async () => {
      try {
        const { data } = await scrutinyApi.getRun(reportId, selectedRunId);
        if (!active) return;
        setRun(data.run);
        setReportData((current) => current ? {
          ...current,
          runs: (current.runs || []).map((item) => item.id === data.run.id ? data.run : item),
        } : current);
        if (data.run.status === "completed") {
          setResultsLoading(true);
          try {
            const response = await scrutinyApi.getResults(reportId, selectedRunId);
            if (active) { setResults(response.data.results || []); setReviews(response.data.reviews || []); }
          } catch (requestError) {
            if (active) setResultsError(errorMessage(requestError, "Run results could not load."));
          } finally {
            if (active) setResultsLoading(false);
          }
        } else if (!isTerminalRun(data.run.status)) {
          timer = window.setTimeout(poll, 2000);
        }
      } catch (requestError) {
        if (active) setRunError(errorMessage(requestError, "Run status could not load."));
      }
    };
    poll();
    return () => { active = false; window.clearTimeout(timer); };
  }, [reportId, selectedRunId, resultsReload]);

  const sources = reportData?.sources || [];
  const runs = reportData?.runs || [];
  const nonReadySelections = useMemo(() => selectedSourceIds.filter((id) => !sources.some((source) => source.id === id && source.parseStatus === "ready")), [selectedSourceIds, sources]);

  async function createRun(event) {
    event.preventDefault();
    setRunError("");
    setRunRefreshError("");
    if (!selectedSourceIds.length || !checkIds.length) return;
    setRunning(true);
    try {
      const { data } = await scrutinyApi.createRun(reportId, selectedSourceIds, checkIds);
      setReportData((current) => current ? { ...current, runs: [data.run, ...(current.runs || []).filter((item) => item.id !== data.run.id)] } : current);
      setSelectedRunId(data.run.id);
      setResultsReload((value) => value + 1);
      try { await refresh(); } catch (requestError) {
        setRunRefreshError(errorMessage(requestError, "Run started, but history could not refresh. Use Refresh to reload it."));
      }
    } catch (requestError) {
      setRunError(errorMessage(requestError, "Audit run could not start."));
    } finally {
      setRunning(false);
    }
  }

  function toggleCheck(id) {
    setCheckIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  return <main className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
    <Link to="/scrutiny/audit-reports" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" />All audit reports</Link>
    {loading ? <PanelLoading label="Loading audit report" /> : null}
    {error ? <Notice tone="danger" title="Report unavailable">{error}</Notice> : null}
    {!loading && !error && reportData ? <>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-5"><div><p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Scrutiny · {reportData.auditReport.fiscalYear}</p><h1 className="mt-1 text-2xl">{reportData.auditReport.name}</h1>{reportData.auditReport.taxpayerId ? <p className="mt-1 text-sm text-muted-foreground">Taxpayer: {reportData.auditReport.taxpayerId}</p> : null}</div><Button variant="outline" size="sm" onClick={() => refresh().catch((requestError) => setError(errorMessage(requestError, "Report could not refresh.")))}><RefreshCw aria-hidden="true" />Refresh</Button></header>
      <SourcesPanel reportId={reportId} sources={sources} onRefresh={refresh} selectedSourceIds={selectedSourceIds} onSelectionChange={setSelectedSourceIds} activeSourceId={activeSourceId} onActiveSourceChange={setActiveSourceId} />
      <Card className="border border-border" aria-labelledby="run-checks-heading"><CardHeader><CardTitle id="run-checks-heading" className="text-lg">Run checks</CardTitle><p className="text-sm text-muted-foreground">Choose the uploaded sources and checks for this run. Incomplete sources may produce insufficient-data findings.</p></CardHeader><CardContent>
        <form className="space-y-4" onSubmit={createRun}>
          <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><legend className="mb-2 text-sm">Checks</legend>{AUDIT_CHECKS.map(([id, label]) => <label key={id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checkIds.includes(id)} onChange={() => toggleCheck(id)} /><span><span className="font-medium">{id}</span> · {label}</span></label>)}</fieldset>
          <p className="text-xs text-muted-foreground">{selectedSourceIds.length} source{selectedSourceIds.length === 1 ? "" : "s"} selected{nonReadySelections.length ? `; ${nonReadySelections.length} incomplete source${nonReadySelections.length === 1 ? "" : "s"} may yield insufficient data` : ""}.</p>
          {runError ? <Notice tone="danger" title="Run unavailable">{runError}</Notice> : null}
          {runRefreshError ? <Notice tone="warning" title="History did not refresh">{runRefreshError}</Notice> : null}
          <Button type="submit" disabled={running || !selectedSourceIds.length || !checkIds.length}><FileSearch aria-hidden="true" />{running ? "Starting…" : "Run selected checks"}</Button>
        </form>
      </CardContent></Card>
      <Card className="border border-border" aria-labelledby="run-history-heading"><CardHeader><CardTitle id="run-history-heading" className="text-lg">Runs and findings</CardTitle></CardHeader><CardContent className="space-y-5">
        {!runs.length ? <p className="text-sm text-muted-foreground">No runs yet. Select a source and at least one check.</p> : <div className="space-y-2"><Label htmlFor="audit-run-history">Run history</Label><select id="audit-run-history" className="h-9 w-full max-w-xl rounded-sm border border-input bg-background px-3 text-sm" value={selectedRunId} onChange={(event) => setSelectedRunId(event.target.value)}>{runs.map((item) => <option key={item.id} value={item.id}>{formatDate(item.createdAt)} · {item.status} · {item.checkIds?.join(", ")}</option>)}</select></div>}
        {selectedRunId && !run && !runError ? <PanelLoading label="Loading run" /> : null}
        {runError ? <Notice tone="danger" title="Run unavailable">{runError}</Notice> : null}
        {run ? <div className="space-y-4"><p className="text-sm">Status: <Status value={run.status} /> · {run.checkIds?.join(", ")}</p>{resultsError ? <Notice tone="danger" title="Results unavailable">{resultsError}<Button className="ml-2" variant="outline" size="sm" onClick={() => setResultsReload((value) => value + 1)}>Retry</Button></Notice> : null}<RunResults reportId={reportId} run={run} results={results} reviews={reviews} sources={sources} loading={resultsLoading} error={resultsError} onReviewSaved={(review) => setReviews((current) => [...current, review])} onInspectSource={(id) => { setActiveSourceId(id); document.getElementById("sources-heading")?.scrollIntoView({ behavior: "smooth" }); }} /></div> : null}
      </CardContent></Card>
    </> : null}
  </main>;
}

export default function AuditReportsPage() {
  return <div className="min-h-screen bg-background text-foreground"><TopNav /><Routes><Route index element={<ReportList />} /><Route path=":reportId" element={<ReportDetail />} /></Routes></div>;
}
