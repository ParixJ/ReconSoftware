import { useEffect, useMemo, useState } from "react";
import { CalendarRange, ClipboardCheck, History, Search } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { errorMessage, reconciliationApi } from "../api/client.js";
import Notice from "../components/Notice.jsx";
import ReconciliationResults from "../components/ReconciliationResults.jsx";
import TopNav from "../components/TopNav.jsx";
import { buildYearReconciliation, clientGstinSearchTarget, indexReconciliationHistory, matchingClientGstins } from "../utils/reconciliationHistory.js";

const CLEAR_CLIENT = "__reconsoft_clear_client__";
const CLEAR_YEAR = "__reconsoft_clear_year__";

function exportScopeKey(scope) {
  if (scope?.fiscalYear) return `fiscal:${scope.fiscalYear}`;
  if (scope?.year) return `year:${scope.year}`;
  return "";
}

function exportScopeLabel(scope) {
  return scope?.fiscalYear || scope?.year || "";
}

export default function ReconciliationsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [reconciliations, setReconciliations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deletingReconciliationId, setDeletingReconciliationId] = useState("");
  const [gstinSearch, setGstinSearch] = useState("");
  const [selectedGstin, setSelectedGstin] = useState(() => String(searchParams.get("gstin") || "").toUpperCase());
  const [selectedYear, setSelectedYear] = useState(() => searchParams.get("year") || "");
  const [exportRows, setExportRows] = useState([]);
  const [exportDataScope, setExportDataScope] = useState(null);
  const [exportDataLoading, setExportDataLoading] = useState(false);
  const [exportDataError, setExportDataError] = useState("");
  const [exportDataReload, setExportDataReload] = useState(0);

  useEffect(() => {
    let active = true;
    reconciliationApi.list()
      .then(({ data }) => { if (active) setReconciliations(data.reconciliations || []); })
      .catch((requestError) => { if (active) setError(errorMessage(requestError, "Reconciliation history could not load.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const history = useMemo(() => indexReconciliationHistory(reconciliations), [reconciliations]);
  const clientGstins = useMemo(() => Object.keys(history).sort(), [history]);
  const yearOptions = useMemo(() => Object.keys(history[selectedGstin] || {}).sort((left, right) => right.localeCompare(left)), [history, selectedGstin]);
  const visibleGstins = useMemo(() => {
    const matching = matchingClientGstins(clientGstins, gstinSearch);
    if (selectedGstin && clientGstins.includes(selectedGstin) && !matching.includes(selectedGstin)) matching.unshift(selectedGstin);
    return matching;
  }, [clientGstins, gstinSearch, selectedGstin]);

  useEffect(() => {
    if (loading) return;
    if (selectedGstin && !clientGstins.includes(selectedGstin)) {
      setSelectedGstin("");
      setSelectedYear("");
    }
  }, [clientGstins, loading, selectedGstin]);

  useEffect(() => {
    if (loading || !selectedGstin) return;
    if (!yearOptions.includes(selectedYear)) setSelectedYear(yearOptions[0] || "");
  }, [loading, selectedGstin, selectedYear, yearOptions]);

  useEffect(() => {
    if (loading) return;
    const next = {};
    if (selectedGstin) next.gstin = selectedGstin;
    if (selectedYear) next.year = selectedYear;
    setSearchParams(next, { replace: true });
  }, [loading, selectedGstin, selectedYear, setSearchParams]);

  const selectedReconciliation = useMemo(() => buildYearReconciliation(
    selectedGstin,
    selectedYear,
    history[selectedGstin]?.[selectedYear],
  ), [history, selectedGstin, selectedYear]);
  const selectedExportScope = useMemo(() => selectedReconciliation?.exportScope || (selectedYear ? { year: selectedYear } : null), [selectedReconciliation, selectedYear]);
  const selectedExportScopeKey = exportScopeKey(selectedExportScope);

  useEffect(() => {
    let active = true;
    const clientGstin = selectedReconciliation?.result?.clientGstin;
    setExportRows([]);
    setExportDataScope(selectedExportScope ? { ...selectedExportScope, periodLabel: exportScopeLabel(selectedExportScope) } : null);
    setExportDataError("");
    if (!clientGstin || !selectedExportScopeKey) {
      setExportDataLoading(false);
      return () => { active = false; };
    }

    setExportDataLoading(true);
    reconciliationApi.exportData(clientGstin, selectedExportScope)
      .then(({ data }) => {
        if (!active) return;
        const exportData = data.exportData || {};
        setExportRows(exportData.rows || []);
        setExportDataScope({
          fiscalYear: exportData.fiscalYear || null,
          year: exportData.year || null,
          periodLabel: exportData.periodLabel || exportScopeLabel(selectedExportScope),
        });
      })
      .catch((requestError) => {
        if (active) setExportDataError(errorMessage(requestError, "The Excel template data could not load."));
      })
      .finally(() => {
        if (active) setExportDataLoading(false);
      });
    return () => { active = false; };
  }, [selectedReconciliation, selectedExportScope, selectedExportScopeKey, exportDataReload]);

  const chooseClient = (gstin) => {
    setSelectedGstin(gstin);
    setSelectedYear(Object.keys(history[gstin] || {}).sort((left, right) => right.localeCompare(left))[0] || "");
  };

  const submitGstinSearch = (event) => {
    event.preventDefault();
    chooseClient(clientGstinSearchTarget(clientGstins, gstinSearch) || "");
  };

  const deleteReconciliation = async (periodResult) => {
    const reconciliationId = periodResult?.sourceReconciliationId;
    if (!reconciliationId) return;
    if (!window.confirm(`Delete the saved reconciliation for ${periodResult.returnPeriod || "this period"}? This removes it from history only; uploaded documents are not deleted.`)) return;
    setDeletingReconciliationId(reconciliationId);
    setDeleteError("");
    try {
      await reconciliationApi.remove(reconciliationId);
      setReconciliations((current) => current.filter((item) => item.id !== reconciliationId));
    } catch (requestError) {
      setDeleteError(errorMessage(requestError, "The reconciliation could not be deleted."));
    } finally {
      setDeletingReconciliationId("");
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-6 sm:px-6 lg:px-8" id="reconciliations">
        <header className="border-b border-border pb-5">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Reconciliation history</p>
          <h1 className="mt-1 text-2xl">Previous reconciliations</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Choose a client GSTIN and return year to review the latest saved result for each available month.</p>
        </header>

        {error ? <Notice tone="danger" title="History could not load">{error}</Notice> : null}
        {deleteError ? <Notice tone="danger" title="Reconciliation could not be deleted" onClose={() => setDeleteError("")}>{deleteError}</Notice> : null}
        {loading ? <Card><CardContent className="flex min-h-36 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner label="Loading reconciliation history" />Loading reconciliation history…</CardContent></Card> : null}

        {!loading && !error && !reconciliations.length ? (
          <Card><CardContent><Empty><EmptyMedia variant="icon"><ClipboardCheck aria-hidden="true" /></EmptyMedia><EmptyHeader><EmptyTitle>No reconciliations ran</EmptyTitle><EmptyDescription>Run a reconciliation from Home to create the first client report.</EmptyDescription></EmptyHeader></Empty></CardContent></Card>
        ) : null}

        {!loading && !error && reconciliations.length && clientGstins.length ? (
          <>
            <Card aria-labelledby="history-filter-heading" className="gap-4">
              <CardHeader className="flex-row items-center justify-between gap-4"><CardTitle id="history-filter-heading" className="text-lg">Find client reports</CardTitle><Badge variant="secondary">{clientGstins.length} client{clientGstins.length === 1 ? "" : "s"}</Badge></CardHeader>
              <CardContent>
                <div className="grid gap-4 lg:grid-cols-[minmax(280px,0.8fr)_minmax(280px,1fr)_180px]">
                  <form className="grid gap-2" onSubmit={submitGstinSearch} role="search">
                    <Label htmlFor="history-gstin-search">Search GSTIN</Label>
                    <InputGroup>
                      <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
                      <InputGroupInput id="history-gstin-search" value={gstinSearch} onChange={(event) => setGstinSearch(event.target.value.toUpperCase())} placeholder="24ABCDE1234F1Z5" maxLength={15} autoComplete="off" />
                      <InputGroupButton size="sm" type="submit" aria-label="Search client GSTIN">Search</InputGroupButton>
                    </InputGroup>
                  </form>
                  <div className="grid gap-2">
                    <Label htmlFor="history-client-gstin">Client GSTIN</Label>
                    <Select value={selectedGstin || undefined} onValueChange={(value) => chooseClient(value === CLEAR_CLIENT ? "" : value)}>
                      <SelectTrigger id="history-client-gstin"><SelectValue placeholder={visibleGstins.length ? "Select client GSTIN" : "No matching GSTINs"} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={CLEAR_CLIENT}>{visibleGstins.length ? "Select client GSTIN" : "No matching GSTINs"}</SelectItem>
                        {visibleGstins.map((gstin) => <SelectItem key={gstin} value={gstin}>{gstin}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="history-return-year">Return year</Label>
                    <Select value={selectedYear || undefined} onValueChange={(value) => setSelectedYear(value === CLEAR_YEAR ? "" : value)} disabled={!selectedGstin}>
                      <SelectTrigger id="history-return-year"><SelectValue placeholder="Select year" /></SelectTrigger>
                      <SelectContent><SelectItem value={CLEAR_YEAR}>Select year</SelectItem>{yearOptions.map((year) => <SelectItem key={year} value={year}>{year}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {!selectedGstin ? <Card><CardContent><Empty><EmptyMedia variant="icon"><History aria-hidden="true" /></EmptyMedia><EmptyHeader><EmptyTitle>Select a client GSTIN</EmptyTitle><EmptyDescription>The report area will show only that client&apos;s reconciliation months and selected year.</EmptyDescription></EmptyHeader></Empty></CardContent></Card> : null}
            {selectedGstin && !selectedYear ? <Card><CardContent><Empty><EmptyMedia variant="icon"><CalendarRange aria-hidden="true" /></EmptyMedia><EmptyHeader><EmptyTitle>No reconciliation years found</EmptyTitle><EmptyDescription>Choose another client GSTIN with an available return period.</EmptyDescription></EmptyHeader></Empty></CardContent></Card> : null}
            {selectedReconciliation ? (
              <>
                <ReconciliationResults
                  reconciliation={selectedReconciliation}
                  onModifyMapping={(id) => navigate(`/home/mapping/${id}`)}
                  onDeleteReconciliation={deleteReconciliation}
                  deletingReconciliationId={deletingReconciliationId}
                  exportRows={exportRows}
                  exportScope={exportDataScope}
                  exportRowsLoading={exportDataLoading}
                  exportRowsError={exportDataError}
                  exportRowsScopeLabel={exportDataScope?.periodLabel || exportScopeLabel(selectedExportScope)}
                  onExportRowsChange={setExportRows}
                  onExportRowsRetry={() => setExportDataReload((current) => current + 1)}
                />
              </>
            ) : null}
          </>
        ) : null}

        {!loading && !error && reconciliations.length && !clientGstins.length ? (
          <Card><CardContent><Empty><EmptyMedia variant="icon"><ClipboardCheck aria-hidden="true" /></EmptyMedia><EmptyHeader><EmptyTitle>No categorized reconciliations</EmptyTitle><EmptyDescription>The saved reconciliations do not contain a client GSTIN and valid return period.</EmptyDescription></EmptyHeader></Empty></CardContent></Card>
        ) : null}
      </main>
    </div>
  );
}
