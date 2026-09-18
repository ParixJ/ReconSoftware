import { useEffect, useState } from "react";
import { ArrowLeft, Save, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Notice from "./Notice.jsx";
import { errorMessage } from "../api/client.js";

const UNMAPPED = "__reconsoft_unmapped__";
const fieldLabels = {
  counterpartyGstin: "Counterparty GSTIN", tradeName: "Trade name", invoiceNumber: "Invoice number", invoiceDate: "Invoice date",
  invoiceValue: "Invoice value", taxableValue: "Taxable value", placeOfSupply: "Place of supply", reverseCharge: "Reverse charge",
  igst: "IGST", cgst: "CGST", sgst: "SGST / UTGST", cess: "Cess",
};

function sampleValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export default function MappingPanel({ document, onClose, onSave, saving }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (document) setForm({
      documentType: document.mapping?.documentType || document.documentType,
      gstin: document.mapping?.gstin || document.gstin || "",
      returnPeriod: document.mapping?.returnPeriod || document.returnPeriod || "",
      fieldMap: document.mapping?.fieldMap || document.parsed.suggestedFieldMap || {},
    });
  }, [document]);

  if (!document || !form) return <div className="grid min-h-screen place-content-center bg-background text-sm text-muted-foreground"><Spinner label="Loading mapping" />Loading mapping…</div>;

  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const updateMap = (key, value) => setForm((current) => ({
    ...current,
    fieldMap: { ...current.fieldMap, [key]: value === UNMAPPED ? "" : value },
  }));
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    try {
      await onSave(form);
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1400px] space-y-5">
        <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start">
          <Button variant="ghost" className="self-start" onClick={onClose}><ArrowLeft aria-hidden="true" />Back to Home</Button>
          <div className="min-w-0"><p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Modify mapping</p><h1 className="mt-1 truncate text-2xl">{document.originalName}</h1><p className="mt-2 text-sm text-muted-foreground">Confirm return identity and map recognized source columns to fixed reconciliation fields.</p></div>
        </header>
        <form className="space-y-5" onSubmit={submit}>
          <Card className="gap-4">
            <CardHeader className="flex-row items-center justify-between"><CardTitle className="text-lg">Return identity</CardTitle><WandSparkles className="size-5 text-muted-foreground" aria-hidden="true" /></CardHeader>
            <CardContent className="space-y-4">
              {error ? <Notice tone="danger" title="Mapping was not saved">{error}</Notice> : null}
              <div className="grid gap-4 md:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="mapping-document-type">Document type</Label>
                  <Select value={form.documentType} onValueChange={(value) => setForm((current) => ({ ...current, documentType: value }))}>
                    <SelectTrigger id="mapping-document-type"><SelectValue placeholder="Choose document type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unknown">Choose document type</SelectItem>
                      <SelectItem value="salesRegister">Sales register</SelectItem>
                      <SelectItem value="gstr1">GSTR-1</SelectItem>
                      <SelectItem value="gstr2">GSTR-2</SelectItem>
                      <SelectItem value="gstr2b">GSTR-2B</SelectItem>
                      <SelectItem value="gstr3b">GSTR-3B</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2"><Label htmlFor="mapping-gstin">Client GSTIN</Label><Input id="mapping-gstin" name="gstin" value={form.gstin} onChange={update} maxLength={15} placeholder="24ABCDE1234F1Z5" /></div>
                <div className="grid gap-2"><Label htmlFor="mapping-return-period">Return period</Label><Input id="mapping-return-period" name="returnPeriod" value={form.returnPeriod} onChange={update} maxLength={13} placeholder="MMYYYY or MMYYYY-MMYYYY" /><small className="text-xs text-muted-foreground">Use one month or a range, for example 032026 or 012025-032025.</small></div>
              </div>
            </CardContent>
          </Card>
          <Card className="gap-4">
            <CardHeader className="flex-row items-center justify-between gap-4"><CardTitle className="text-lg">Column mapping</CardTitle><span className="text-xs text-muted-foreground">{document.parsed.sourceFields.length} source fields</span></CardHeader>
            <CardContent>
              {!document.parsed.sourceFields.length ? (
                <Notice tone="info" title="Official GST schema recognized">This file uses a built-in nested GST return mapping. Confirm the return identity above; invoice and tax fields are already mapped to the fixed table.</Notice>
              ) : (
                <Table aria-label="Column mapping" className="min-w-[760px]">
                  <TableHeader><TableRow><TableHead>Reconciliation field</TableHead><TableHead>Source column</TableHead><TableHead>Sample value</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {Object.entries(fieldLabels).map(([key, label]) => {
                      const selected = form.fieldMap[key] || "";
                      const sample = selected ? document.parsed.sourceRows?.find((row) => row[selected] !== "" && row[selected] != null)?.[selected] : "";
                      return (
                        <TableRow key={key}>
                          <TableCell>{label}</TableCell>
                          <TableCell className="min-w-72">
                            <Select value={selected || UNMAPPED} onValueChange={(value) => updateMap(key, value)}>
                              <SelectTrigger aria-label={`${label} source column`}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value={UNMAPPED}>Not mapped</SelectItem>
                                {document.parsed.sourceFields.map((field) => <SelectItem key={field} value={field}>{field}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="max-w-md truncate text-muted-foreground" title={sampleValue(sample)}>{sampleValue(sample)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? <Spinner className="text-primary-foreground" label="Saving mapping" /> : <Save aria-hidden="true" />}Save mapping</Button>
          </div>
        </form>
      </div>
    </main>
  );
}
