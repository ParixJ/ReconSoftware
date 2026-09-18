import { useState } from "react";
import { AlertOctagon, ArrowDownRight, ArrowUpRight, CheckCircle2, ClipboardCheck, Download, Eye, Lightbulb, Scale, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { errorMessage, reconciliationApi } from "../api/client.js";
import { money, period, TYPE_LABELS } from "../utils/format.js";
import ExportTemplateDataTable from "./ExportTemplateDataTable.jsx";
import Notice from "./Notice.jsx";
import Popup from "./Popup.jsx";

const FISCAL_YEAR_PATTERN = /^(\d{4})-(\d{4})$/;
const RETURN_YEAR_PATTERN = /^\d{4}$/;

function Metric({ label, value, detail, tone = "neutral" }) {
  const toneClasses = {
    neutral: "bg-muted/55",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    danger: "bg-destructive/10 text-destructive",
  };
  return (
    <div className={cn("space-y-1 p-4", toneClasses[tone] || toneClasses.neutral)}>
      <span className="block text-xs uppercase tracking-wide opacity-80">{label}</span>
      <span className="block text-2xl tabular-nums">{value}</span>
      <small className="block text-xs opacity-80">{detail}</small>
    </div>
  );
}

function fiscalYearForPeriod(returnPeriod) {
  const periodValue = String(returnPeriod || "").match(/^((?:0[1-9]|1[0-2])\d{4})(?:-(?:0[1-9]|1[0-2])\d{4})?$/)?.[1];
  if (!periodValue) return null;
  const month = Number(periodValue.slice(0, 2));
  const year = Number(periodValue.slice(2));
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

function exportRowsForScope(rows, scope, inputScope) {
  if (!Array.isArray(rows) || !rows.length || !scope || !inputScope) return null;
  const sameFiscalYear = inputScope.fiscalYear && scope.fiscalYear === inputScope.fiscalYear;
  const sameReturnYear = inputScope.year && scope.year === inputScope.year;
  if (!sameFiscalYear && !sameReturnYear) return null;
  const amendedRows = rows
    .filter((row) => row.amended && String(row.amendment ?? "").trim() !== "")
    .map((row) => ({ id: row.id, value: row.amendment }));
  return amendedRows.length ? amendedRows : null;
}

function periodPriority(result) {
  if (Number(result.summary?.highRisk || 0) > 0) return { label: "High priority", variant: "destructive", icon: AlertOctagon };
  if (result.status === "matched") return { label: "Matched", variant: "success", icon: CheckCircle2 };
  return { label: "Review required", variant: "warning", icon: AlertOctagon };
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
  const comparisons = result.comparisons || [];
  const exceptions = result.exceptions || [];
  const suggestions = result.suggestions || [];

  return (
    <div className="space-y-5">
      <Card className="gap-4">
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">Books, liability and ITC comparison</CardTitle>
          <Badge variant={result.status === "matched" ? "success" : "warning"} data-kind="status">
            {result.status === "matched" ? <CheckCircle2 aria-hidden="true" /> : <AlertOctagon aria-hidden="true" />}
            {result.status === "matched" ? "Matched" : "Review required"}
          </Badge>
        </CardHeader>
        <CardContent>
          {comparisons.length ? (
            <Table aria-label={`${period(result.returnPeriod)} comparison details`} className="min-w-[1100px]">
              <TableHeader><TableRow><TableHead>Table</TableHead><TableHead>Check</TableHead><TableHead>Field</TableHead><TableHead className="text-right">Source</TableHead><TableHead className="text-right">Compared with</TableHead><TableHead className="text-right">Difference</TableHead><TableHead>Status</TableHead><TableHead>Suggested review</TableHead></TableRow></TableHeader>
              <TableBody>
                {comparisons.map((item) => (
                  <TableRow key={item.id} className={item.status === "mismatch" ? "bg-destructive/6 hover:bg-destructive/10" : undefined}>
                    <TableCell><Badge variant="outline" data-kind="document-type">{item.table}</Badge></TableCell>
                    <TableCell>{item.label}</TableCell>
                    <TableCell>{item.measureLabel}</TableCell>
                    <TableCell className="text-right tabular-nums"><small className="block text-xs text-muted-foreground">{item.sourceLabel || "Source"}</small>{money(item.sourceValue)}</TableCell>
                    <TableCell className="text-right tabular-nums"><small className="block text-xs text-muted-foreground">{item.filedLabel || "GSTR-3B"}</small>{money(item.filedValue)}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", item.difference ? "text-destructive" : "text-success")}>
                      <span className="inline-flex items-center justify-end gap-1">{item.difference > 0 ? <ArrowUpRight className="size-3.5" aria-hidden="true" /> : item.difference < 0 ? <ArrowDownRight className="size-3.5" aria-hidden="true" /> : null}{money(item.difference)}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.status === "matched" ? "success" : "destructive"} data-kind="status" className={item.status === "matched" ? undefined : "status-warning"}>
                        {item.status === "matched" ? <CheckCircle2 aria-hidden="true" /> : <AlertOctagon aria-hidden="true" />}
                        {item.status === "matched" ? "Matched" : item.risk === "high" ? "High priority" : "Review"}
                      </Badge>
                    </TableCell>
                    <TableCell className="min-w-64 text-muted-foreground">{item.suggestion}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Empty>
              <EmptyMedia variant="icon"><ClipboardCheck aria-hidden="true" /></EmptyMedia>
              <EmptyHeader><EmptyTitle>No safe comparisons for this period</EmptyTitle><EmptyDescription>Resolve the period exceptions before comparing return values.</EmptyDescription></EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      {exceptions.length ? (
        <Card className="gap-4">
          <CardHeader className="flex-row items-center justify-between gap-4"><CardTitle className="text-base">Document exceptions</CardTitle><Badge variant="destructive">{exceptions.length}</Badge></CardHeader>
          <CardContent className="space-y-2">
            {exceptions.map((item) => (
              <article key={item.id} className="grid gap-3 bg-destructive/8 p-3 text-sm sm:grid-cols-[auto_1fr_auto]" data-exception-id={item.id}>
                <AlertOctagon className="mt-0.5 size-4 text-destructive" aria-hidden="true" />
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-foreground">{item.message}</span><Badge variant="destructive">{String(item.code || "exception").replaceAll("_", " ")}</Badge></div>
                  {item.documentName ? <small className="block text-xs text-muted-foreground">{item.documentName}</small> : null}
                  <p className="text-muted-foreground">{item.suggestion}</p>
                </div>
                {item.documentId ? <Button variant="ghost" size="sm" onClick={() => onModifyMapping(item.documentId)}>Modify mapping</Button> : null}
              </article>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {suggestions.length ? (
        <div className="flex gap-3 bg-info/10 p-4 text-info"><Lightbulb className="mt-0.5 size-5 shrink-0" aria-hidden="true" /><div><h3 className="text-sm">Suggested review sequence</h3><ol className="mt-2 list-decimal space-y-1 pl-5 text-sm opacity-85">{suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ol></div></div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 bg-muted/55 p-3 text-xs text-muted-foreground">
        <span>Files used for {period(result.returnPeriod)}:</span>
        {(result.documents || []).map((document) => <Badge key={document.id} variant="outline"><span>{TYPE_LABELS[document.documentType] || "Document"}</span>{document.originalName}</Badge>)}
      </div>
    </div>
  );
}

function PeriodResultsTable({ periods, onOpen, onDeleteReconciliation, deletingReconciliationId }) {
  return (
    <Card className="gap-4">
      <CardHeader className="flex-row items-center justify-between gap-4"><CardTitle className="text-base">Period reconciliation summary</CardTitle><Badge variant="secondary">{periods.length} period{periods.length === 1 ? "" : "s"}</Badge></CardHeader>
      <CardContent>
        <Table aria-label="Period reconciliation summary" className="min-w-[980px]">
          <TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total difference</TableHead><TableHead className="text-right">Checks</TableHead><TableHead className="text-right">Exceptions</TableHead><TableHead>Files</TableHead><TableHead><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {periods.map((item, index) => {
              const priority = periodPriority(item);
              const PriorityIcon = priority.icon;
              const canDelete = Boolean(onDeleteReconciliation && item.sourceReconciliationId);
              const deleting = deletingReconciliationId === item.sourceReconciliationId;
              return (
                <TableRow
                  key={item.returnPeriod || `unassigned-${index}`}
                  className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  tabIndex={0}
                  onClick={() => onOpen(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpen(item);
                    }
                  }}
                >
                  <TableCell><span className="block text-foreground">{period(item.returnPeriod)}</span><small className="font-mono text-xs text-muted-foreground">{item.clientGstin || "GSTIN not detected"}</small></TableCell>
                  <TableCell><Badge variant={priority.variant} data-kind="status" className={priority.variant === "destructive" ? "status-warning" : undefined}><PriorityIcon aria-hidden="true" />{priority.label}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{money(item.summary?.totalAbsoluteDifference)}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(item.summary?.matched || 0)} / {Number(item.summary?.totalChecks || 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{Number(item.summary?.exceptions || 0)}</TableCell>
                  <TableCell className="min-w-52 text-muted-foreground">{documentSummary(item.documents)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); onOpen(item); }} aria-label={`View ${period(item.returnPeriod)} details`}><Eye aria-hidden="true" />View details</Button>
                      {canDelete ? (
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={deleting} onClick={(event) => { event.stopPropagation(); onDeleteReconciliation(item); }} aria-label={`Delete reconciliation for ${period(item.returnPeriod)}`}>
                          {deleting ? <Spinner label="Deleting reconciliation" /> : <Trash2 aria-hidden="true" />}
                          {deleting ? "Deleting…" : "Delete"}
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function ReconciliationResults({
  reconciliation,
  onModifyMapping,
  onDeleteReconciliation,
  deletingReconciliationId,
  exportRows,
  exportScope,
  exportRowsLoading,
  exportRowsError,
  exportRowsScopeLabel,
  onExportRowsChange,
  onExportRowsRetry,
}) {
  const [activePeriod, setActivePeriod] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportForm, setExportForm] = useState({ documentName: "", format: "excel", fiscalYear: "" });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  if (!reconciliation) return (
    <Card id="results"><CardContent><Empty><EmptyMedia variant="icon"><ClipboardCheck aria-hidden="true" /></EmptyMedia><EmptyHeader><EmptyTitle>No reconciliation run yet</EmptyTitle><EmptyDescription>Select GSTR-1 and GSTR-3B files, then run the comparison. A sales register adds books checks; GSTR-2B adds ITC checks.</EmptyDescription></EmptyHeader></Empty></CardContent></Card>
  );

  const { result } = reconciliation;
  const review = reconciliation.status === "needs_review";
  const resultPeriods = result.periods?.length ? result.periods : [{ ...result, status: reconciliation.status }];
  const resultYears = [...new Set(resultPeriods.map((item) => String(item.returnPeriod || "").match(/^(?:0[1-9]|1[0-2])(\d{4})/)?.[1]).filter((year) => /^\d{4}$/.test(year || "")))];
  const exportReturnYear = RETURN_YEAR_PATTERN.test(reconciliation.exportScope?.year || "") ? reconciliation.exportScope.year : "";
  const exportUsesReturnYear = Boolean(exportReturnYear);
  const exportFiscalYear = defaultFiscalYear(resultPeriods);
  const canExport = Boolean(result.clientGstin);
  const knownPeriodCount = resultPeriods.filter((item) => item.returnPeriod).length;
  const headingPeriod = knownPeriodCount > 1 ? `${knownPeriodCount} return periods` : period(resultPeriods[0]?.returnPeriod || result.returnPeriod);

  const openExportPopup = () => {
    const periodScope = exportReturnYear || exportFiscalYear || (resultYears.length === 1 ? `${resultYears[0]}-${Number(resultYears[0]) + 1}` : "");
    setExportError("");
    setExportForm({ documentName: defaultExportName(result.clientGstin, periodScope), format: "excel", fiscalYear: periodScope });
    setExportOpen(true);
  };

  const exportToExcel = async (event) => {
    event.preventDefault();
    const fiscalYear = exportForm.fiscalYear.trim();
    if (exportUsesReturnYear ? !RETURN_YEAR_PATTERN.test(fiscalYear) : !fiscalYearIsValid(fiscalYear)) {
      setExportError(exportUsesReturnYear
        ? "Enter the return year in exact YYYY format, for example 2025."
        : "Enter the fiscal year in exact YYYY-YYYY format, for example 2025-2026.");
      return;
    }
    if (exportForm.format !== "excel") {
      setExportError("Only Excel export is available right now.");
      return;
    }
    setExporting(true);
    setExportError("");
    try {
      const periodScope = exportUsesReturnYear ? { year: fiscalYear } : { fiscalYear };
      const input = {
        ...periodScope,
        filename: exportForm.documentName,
        format: exportForm.format,
      };
      const amendedRows = exportRowsForScope(exportRows, exportScope, periodScope);
      const response = amendedRows
        ? await reconciliationApi.exportWorkbookWithRows(result.clientGstin, { ...input, rows: amendedRows })
        : await reconciliationApi.exportWorkbook(result.clientGstin, input);
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
    <section className="space-y-5" id="results" aria-labelledby="results-heading">
      <div className="flex flex-col justify-between gap-4 border-b border-border pb-5 lg:flex-row lg:items-start">
        <div><p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Reconciliation report</p><h2 id="results-heading" className="mt-1 text-xl">{headingPeriod} · <span className="font-mono">{result.clientGstin || "GSTIN not detected"}</span></h2><p className="mt-2 max-w-3xl text-sm text-muted-foreground">{result.methodology}</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={review ? "warning" : "success"} data-kind="status">{review ? <AlertOctagon aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}{review ? "Review required" : "Matched"}</Badge>
          <Button variant="outline" onClick={openExportPopup} disabled={!canExport || exporting}>{exporting ? <Spinner label="Preparing Excel" /> : <Download aria-hidden="true" />}{exporting ? "Preparing Excel…" : "Export to Excel"}</Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Checks matched" value={`${result.summary.matched} / ${result.summary.totalChecks}`} detail="Across all selected periods" tone="success" />
        <Metric label="Value differences" value={result.summary.mismatched} detail={money(result.summary.totalAbsoluteDifference)} tone={result.summary.mismatched ? "warning" : "success"} />
        <Metric label="Data exceptions" value={result.summary.exceptions} detail="Identity, period or source checks" tone={result.summary.exceptions ? "warning" : "neutral"} />
        <Metric label="High priority" value={result.summary.highRisk} detail="Resolve before relying on return" tone={result.summary.highRisk ? "danger" : "success"} />
      </div>
      <PeriodResultsTable periods={resultPeriods} onOpen={setActivePeriod} onDeleteReconciliation={onDeleteReconciliation} deletingReconciliationId={deletingReconciliationId} />
      <Popup open={Boolean(activePeriod)} title={`${period(activePeriod?.returnPeriod)} reconciliation details`} description="Detailed comparison rows, document exceptions, suggestions, source files, and editable export spreadsheet values." onClose={() => setActivePeriod(null)} size="wide">
        {activePeriod ? (
          <div className="space-y-6">
            <PeriodReport result={activePeriod} onModifyMapping={(id) => { setActivePeriod(null); onModifyMapping(id); }} />
            <ExportTemplateDataTable
              rows={exportRows}
              loading={exportRowsLoading}
              error={exportRowsError}
              scopeLabel={exportRowsScopeLabel || exportScope?.periodLabel}
              onRowsChange={onExportRowsChange}
              onRetry={onExportRowsRetry}
            />
          </div>
        ) : null}
      </Popup>
      <Popup
        open={exportOpen}
        title="Export reconciliation"
        description="Enter the file details for the reconciliation export."
        onClose={() => { if (!exporting) setExportOpen(false); }}
        size="medium"
        footer={
          <>
            <Button variant="outline" type="button" onClick={() => setExportOpen(false)} disabled={exporting}>Cancel</Button>
            <Button type="submit" form="reconciliation-export-form" disabled={exporting}>{exporting ? <Spinner className="text-primary-foreground" label="Preparing export" /> : <Download aria-hidden="true" />}{exporting ? "Preparing..." : "Download"}</Button>
          </>
        }
      >
        <form id="reconciliation-export-form" className="space-y-4" onSubmit={exportToExcel}>
          <div className="grid gap-2"><Label htmlFor="export-document-name">Document name</Label><Input id="export-document-name" value={exportForm.documentName} onChange={(event) => setExportForm((current) => ({ ...current, documentName: event.target.value }))} placeholder="GST_Reconciliation_Client_FY" autoComplete="off" /></div>
          <div className="grid gap-2">
            <Label htmlFor="export-format">Document file format</Label>
            <Select value={exportForm.format} onValueChange={(format) => setExportForm((current) => ({ ...current, format }))}>
              <SelectTrigger id="export-format"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="excel">Excel (.xlsx)</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="grid gap-2"><Label htmlFor="export-fiscal-year">{exportUsesReturnYear ? "Return year" : "Fiscal year"}</Label><Input id="export-fiscal-year" value={exportForm.fiscalYear} onChange={(event) => setExportForm((current) => ({ ...current, fiscalYear: event.target.value }))} placeholder={exportUsesReturnYear ? "2025" : "2025-2026"} pattern={exportUsesReturnYear ? "\\d{4}" : "\\d{4}-\\d{4}"} required autoComplete="off" /></div>
        </form>
        {exportError ? <div className="mt-4"><Notice tone="danger" title="Excel export failed" onClose={() => setExportError("")}>{exportError}</Notice></div> : null}
      </Popup>
    </section>
  );
}
