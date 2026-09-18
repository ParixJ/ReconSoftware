import { BadgeCheck, Play, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export default function ReconciliationControls({ selectedCount, crossExamination, values, gstinValue, onChange, onGstinChange, onApplyGstin, running, applyingGstin, onRun }) {
  const selectionInvalid = selectedCount < 2 || selectedCount > 100;
  const gstinMismatch = crossExamination.status === "mismatch";
  const gstinMissing = crossExamination.status === "unverified";
  const gstinInvalid = Boolean(gstinValue) && !GSTIN_PATTERN.test(gstinValue);
  const runTitle = gstinMismatch
    ? "Selected documents identify different client GSTINs."
    : gstinMissing
      ? "Map the client GSTIN before running reconciliation."
      : selectedCount > 100
        ? "Reconciliation supports up to 100 selected files."
        : undefined;

  return (
    <Card aria-labelledby="reconcile-heading" className="w-full gap-4">
      <CardHeader className="flex-row items-center gap-3">
        <span className="grid size-9 place-items-center bg-muted text-primary"><SlidersHorizontal className="size-[18px]" aria-hidden="true" /></span>
        <CardTitle id="reconcile-heading" className="text-lg">Run reconciliation</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 xl:flex-row xl:items-end">
        <div className="grid flex-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="compact-field grid gap-2">
            <Label htmlFor="amount-tolerance">Price tolerance (₹)</Label>
            <Input id="amount-tolerance" type="number" min="0" max="1000000" step="0.01" name="amountTolerance" value={values.amountTolerance} onChange={onChange} />
          </div>
          <div className="compact-field grid gap-2">
            <Label htmlFor="date-tolerance">Date tolerance (days)</Label>
            <Input id="date-tolerance" type="number" min="0" max="90" step="1" name="dateToleranceDays" value={values.dateToleranceDays} onChange={onChange} />
          </div>
          <div className="compact-field grid gap-2 sm:col-span-2 xl:col-span-1">
            <Label htmlFor="bulk-gstin">Client GSTIN</Label>
            <Input
              id="bulk-gstin"
              type="text"
              name="bulkGstin"
              value={gstinValue}
              onChange={onGstinChange}
              maxLength={15}
              pattern="\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]"
              placeholder="24ABCDE1234F1Z5"
              autoComplete="off"
              aria-invalid={gstinInvalid || undefined}
            />
          </div>
          <Button className="self-end" variant="outline" type="button" onClick={onApplyGstin} disabled={!selectedCount || applyingGstin || gstinInvalid}>
            {applyingGstin ? <Spinner label="Applying GSTIN" /> : <BadgeCheck aria-hidden="true" />}{applyingGstin ? "Applying…" : "Apply GSTIN"}
          </Button>
        </div>
        <Button className="xl:min-w-52" onClick={onRun} disabled={running || selectionInvalid || gstinMismatch || gstinMissing} title={runTitle}>
          {running ? <Spinner className="text-primary-foreground" label="Reconciling documents" /> : <Play aria-hidden="true" />}
          {running ? "Reconciling…" : gstinMismatch ? "Resolve GSTIN mismatch" : gstinMissing ? "Client GSTIN required" : selectedCount > 100 ? "Select up to 100 files" : `Run on ${selectedCount} files`}
        </Button>
      </CardContent>
    </Card>
  );
}
