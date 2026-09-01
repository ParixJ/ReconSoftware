import { useEffect, useMemo, useState } from "react";
import { CalendarRange, ClipboardCheck, History, Search } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { errorMessage, reconciliationApi } from "../api/client.js";
import Notice from "../components/Notice.jsx";
import ReconciliationResults from "../components/ReconciliationResults.jsx";
import TopNav from "../components/TopNav.jsx";
import { buildYearReconciliation, clientGstinSearchTarget, indexReconciliationHistory, matchingClientGstins } from "../utils/reconciliationHistory.js";

export default function ReconciliationsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [reconciliations, setReconciliations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [gstinSearch, setGstinSearch] = useState("");
  const [selectedGstin, setSelectedGstin] = useState(() => String(searchParams.get("gstin") || "").toUpperCase());
  const [selectedYear, setSelectedYear] = useState(() => searchParams.get("year") || "");

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

  const chooseClient = (gstin) => {
    setSelectedGstin(gstin);
    setSelectedYear(Object.keys(history[gstin] || {}).sort((left, right) => right.localeCompare(left))[0] || "");
  };

  const selectClient = (event) => chooseClient(event.target.value);

  const submitGstinSearch = (event) => {
    event.preventDefault();
    chooseClient(clientGstinSearchTarget(clientGstins, gstinSearch) || "");
  };
  
  return (
    <div className="workspace-shell">
      <TopNav />
      <main className="workspace reconciliation-history-page" id="reconciliations">
        <header className="page-header">
          <div><p className="eyebrow">Reconciliation history</p><h1>Previous reconciliations</h1><p>Choose a client GSTIN and return year to review the latest saved result for each available month.</p></div>
          <div className="page-context"><small>History view</small><strong>Client GSTIN + year</strong><span>Monthly reports remain separated in tabs</span></div>
        </header>

        {error ? <Notice tone="danger" title="History could not load">{error}</Notice> : null}
        {loading ? <div className="panel loading-block"><span className="spinner" />Loading reconciliation history…</div> : null}

        {!loading && !error && !reconciliations.length ? (
          <section className="panel results-empty history-empty"><ClipboardCheck size={30} /><div><h2>No reconciliations ran</h2><p>Run a reconciliation from Home to create the first client report.</p></div></section>
        ) : null}

        {!loading && !error && reconciliations.length && clientGstins.length ? (
          <>
            <section className="panel history-filter-panel" aria-labelledby="history-filter-heading">
              <div className="section-heading compact-heading"><div><h2 id="history-filter-heading">Find client reports</h2><p>Enter a complete or partial GSTIN and press Enter or Search, then choose the return year.</p></div><span className="count-badge">{clientGstins.length} client{clientGstins.length === 1 ? "" : "s"}</span></div>
              <div className="history-filter-row">
                <form className="field history-search-field" onSubmit={submitGstinSearch} role="search">
                  <label htmlFor="history-gstin-search">Search GSTIN</label>
                  <span className="history-search-input"><Search size={16} /><input id="history-gstin-search" value={gstinSearch} onChange={(event) => setGstinSearch(event.target.value)} placeholder="24ABCDE1234F1Z5" maxLength={15} autoComplete="off" /><button className="history-search-submit" type="submit">Search</button></span>
                </form>
                <label className="field history-client-field"><span>Client GSTIN</span><select value={selectedGstin} onChange={selectClient}><option value="">{visibleGstins.length ? "Select client GSTIN" : "No matching GSTINs"}</option>{visibleGstins.map((gstin) => <option key={gstin} value={gstin}>{gstin}</option>)}</select></label>
                <label className="field history-year-field"><span>Return year</span><select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)} disabled={!selectedGstin}><option value="">Select year</option>{yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
              </div>
            </section>

            {!selectedGstin ? <section className="panel results-empty history-prompt"><History size={30} /><div><h2>Select a client GSTIN</h2><p>The report area will show only that client&apos;s reconciliation months and selected year.</p></div></section> : null}
            {selectedGstin && !selectedYear ? <section className="panel results-empty history-prompt"><CalendarRange size={30} /><div><h2>No reconciliation years found</h2><p>Choose another client GSTIN with an available return period.</p></div></section> : null}
            {selectedReconciliation ? <ReconciliationResults reconciliation={selectedReconciliation} onModifyMapping={(id) => navigate(`/home/mapping/${id}`)} /> : null}
          </>
        ) : null}

        {!loading && !error && reconciliations.length && !clientGstins.length ? (
          <section className="panel results-empty history-empty"><ClipboardCheck size={30} /><div><h2>No categorized reconciliations</h2><p>The saved reconciliations do not contain a client GSTIN and valid return period.</p></div></section>
        ) : null}
      </main>
      <footer className="workspace-footer"><span>Reconcile GST</span><span>Audit support only · Source returns are never modified</span></footer>
    </div>
  );
}
