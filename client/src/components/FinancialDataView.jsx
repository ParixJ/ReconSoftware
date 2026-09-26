import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  evidenceFacts,
  evidenceIssues,
  financialTable,
  formatFinancialValue,
  ledgerSummaryTable,
  ledgerTransactionTable,
} from "../api/scrutinyPresentation.js";

const DocumentGrid = lazy(() => import("./DocumentGrid.jsx"));

function Grid({ fields, rows, label }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No financial rows are available for this section.</p>;
  return <Suspense fallback={<p className="text-sm text-muted-foreground">Loading {label.toLowerCase()}…</p>}>
    <DocumentGrid fields={fields} rows={rows} />
  </Suspense>;
}

function SourceSummary({ parsed }) {
  const facts = [
    ["Client / entity", parsed?.entityName],
    ["PAN / GSTIN", parsed?.taxpayerId],
    ["Financial year", parsed?.financialYear],
    ["Records", parsed?.recordCount],
    ["Pages", parsed?.pageCount],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!facts.length) return null;
  return <dl className="grid gap-3 rounded-sm border border-border bg-muted/30 p-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
    {facts.map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium tabular-nums">{value}</dd></div>)}
  </dl>;
}

function LedgerView({ parsed }) {
  const records = useMemo(() => Array.isArray(parsed?.records) ? parsed.records : [], [parsed]);
  const [ledgerIndex, setLedgerIndex] = useState(0);
  useEffect(() => { setLedgerIndex(0); }, [parsed]);
  const summary = useMemo(() => ledgerSummaryTable(records), [records]);
  const selected = records[ledgerIndex] || null;
  const transactions = useMemo(() => ledgerTransactionTable(selected), [selected]);
  return <div className="space-y-5">
    <section className="space-y-2" aria-labelledby="ledger-summary-heading">
      <div><h5 id="ledger-summary-heading" className="font-medium">Ledger account summary</h5><p className="text-xs text-muted-foreground">Opening balance, period movements and closing balance for every client ledger in the workbook.</p></div>
      <Grid {...summary} label="Ledger account summary" />
    </section>
    {records.length ? <section className="space-y-3 rounded-sm border border-border p-3" aria-labelledby="ledger-transactions-heading">
      <div className="grid gap-2 sm:max-w-xl">
        <Label htmlFor="financial-ledger-selection">Ledger transaction detail</Label>
        <select id="financial-ledger-selection" className="h-10 rounded-sm border border-input bg-background px-3 text-sm" value={ledgerIndex} onChange={(event) => setLedgerIndex(Number(event.target.value))}>
          {records.map((record, index) => <option key={`${record.ledger || "ledger"}-${index}`} value={index}>{record.entityName ? `${record.entityName} · ` : ""}{record.ledger || `Ledger ${index + 1}`}</option>)}
        </select>
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Opening balance", selected?.openingBalance], ["Total debits", selected?.debits],
          ["Total credits", selected?.credits], ["Closing balance", selected?.closingBalance],
          ["Transactions", selected?.entries?.length || 0],
        ].map(([label, value]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-medium tabular-nums">{label === "Transactions" ? value : formatFinancialValue("amount", value)}</p></div>)}
      </div>
      <div><h5 id="ledger-transactions-heading" className="mb-2 font-medium">{selected?.ledger || "Ledger"} transactions</h5><Grid {...transactions} label="Ledger transactions" /></div>
    </section> : null}
  </div>;
}

function TableControls({ tables }) {
  const presentation = useMemo(() => financialTable((tables || []).map((table) => ({
    informationCode: table.informationCode,
    description: table.description || table.category,
    count: table.printedCount ?? table.rowCount ?? table.records?.length,
    amount: table.printedAmount ?? table.totalAmount,
    status: table.status,
  }))), [tables]);
  if (!presentation.rows.length) return null;
  return <section className="space-y-2"><div><h5 className="font-medium">Statement control totals</h5><p className="text-xs text-muted-foreground">Printed counts and amounts used to validate the extracted financial tables.</p></div><Grid {...presentation} label="Statement control totals" /></section>;
}

export function FinancialSourceView({ parsed, role }) {
  const records = Array.isArray(parsed?.records) ? parsed.records : [];
  const table = useMemo(() => financialTable(records), [records]);
  const isLedger = role === "books_ledgers" && records.some((record) => record?.ledger);
  return <div className="space-y-5">
    <SourceSummary parsed={parsed} />
    {isLedger ? <LedgerView parsed={parsed} /> : table.rows.length ? <section className="space-y-2"><div><h5 className="font-medium">Financial records</h5><p className="text-xs text-muted-foreground">Normalized business fields are shown below; parser coordinates and internal provenance are omitted.</p></div><Grid {...table} label="Financial records" /></section> : <p className="text-sm text-muted-foreground">No structured financial records are available for this source. Use the original file and parsing issues for review.</p>}
    <TableControls tables={parsed?.tables} />
  </div>;
}

export function FinancialEvidence({ item }) {
  const facts = evidenceFacts(item);
  const issues = evidenceIssues(item);
  const comparison = item?.comparison ? String(item.comparison).replaceAll("_", " ") : null;
  return <div className="space-y-2">
    {comparison ? <Badge variant="outline" className="capitalize">{comparison}</Badge> : null}
    {facts.length ? <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">{facts.map((fact) => <div key={fact.field} className="min-w-0"><dt className="text-xs text-muted-foreground">{fact.label}</dt><dd className="break-words font-medium text-foreground tabular-nums">{fact.value}</dd></div>)}</dl> : null}
    {issues.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-warning">{issues.map((issue, index) => <li key={`${issue}-${index}`}>{issue}</li>)}</ul> : null}
    {!facts.length && !issues.length ? <p className="text-sm text-muted-foreground">Supporting evidence is available in the linked source document.</p> : null}
  </div>;
}

