import { useMemo } from "react";
import { AlertTriangle, Check, FileCog, FileJson2, FileSpreadsheet, FileText, Inbox, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/ui/data-table";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { TYPE_LABELS, dateTime, period } from "../utils/format.js";

const fileIcons = { json: FileJson2, xlsx: FileSpreadsheet, csv: FileSpreadsheet, pdf: FileText };

export default function DocumentLibrary({ documents, selectedIds, onToggle, onToggleAll, onMap, onDelete, onDeleteSelected, deletingId, bulkDeleting }) {
  const selectedCount = documents.filter((document) => selectedIds.includes(document.id)).length;
  const allSelected = documents.length > 0 && selectedCount === documents.length;
  const partiallySelected = selectedCount > 0 && !allSelected;
  const deleting = Boolean(deletingId) || bulkDeleting;
  const rowSelection = useMemo(
    () => Object.fromEntries(selectedIds.map((id) => [String(id), true])),
    [selectedIds],
  );

  const columns = useMemo(() => [
    {
      id: "select",
      header: () => (
        <Checkbox
          checked={partiallySelected ? "indeterminate" : allSelected}
          onCheckedChange={(checked) => onToggleAll(Boolean(checked))}
          disabled={deleting}
          aria-label={allSelected ? "Clear document selection" : "Select all documents"}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={selectedIds.includes(row.original.id)}
          onCheckedChange={() => onToggle(row.original.id)}
          disabled={deleting}
          aria-label={`Select ${row.original.originalName}`}
        />
      ),
    },
    {
      accessorKey: "originalName",
      header: "Document",
      cell: ({ row }) => {
        const document = row.original;
        const Icon = fileIcons[document.fileType] || FileText;
        return (
          <div className="flex min-w-52 items-center gap-3">
            <span className="grid size-8 shrink-0 place-items-center bg-muted text-muted-foreground"><Icon className="size-4" aria-hidden="true" /></span>
            <span className="min-w-0"><span className="block max-w-72 truncate text-foreground" title={document.originalName}>{document.originalName}</span><small className="text-xs uppercase text-muted-foreground">{document.fileType}</small></span>
          </div>
        );
      },
    },
    {
      accessorKey: "documentType",
      header: "Return",
      cell: ({ row }) => <Badge variant="outline" data-kind="document-type">{TYPE_LABELS[row.original.documentType] || "Unknown"}</Badge>,
    },
    {
      accessorKey: "gstin",
      header: "Client GSTIN",
      cell: ({ row }) => row.original.gstin
        ? <span className="font-mono text-xs">{row.original.gstin}</span>
        : <span className="text-destructive">Not detected</span>,
    },
    {
      accessorKey: "returnPeriod",
      header: "Period",
      cell: ({ row }) => period(row.original.returnPeriod),
    },
    {
      accessorKey: "recordCount",
      header: () => <span className="block text-right">Records</span>,
      cell: ({ row }) => <span className="block text-right tabular-nums">{Number(row.original.recordCount || 0).toLocaleString("en-IN")}</span>,
    },
    {
      id: "review",
      header: "Review state",
      cell: ({ row }) => {
        const issues = row.original.anomalies?.length || 0;
        return issues ? (
          <Badge variant="destructive" data-kind="status" className="status-warning"><AlertTriangle aria-hidden="true" />{issues} {issues === 1 ? "issue" : "issues"}</Badge>
        ) : (
          <Badge variant="success" data-kind="status"><Check aria-hidden="true" />Ready</Badge>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: "Uploaded",
      cell: ({ row }) => <span className="whitespace-nowrap text-muted-foreground">{dateTime(row.original.createdAt)}</span>,
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex min-w-max justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => onMap(row.original.id)} disabled={deleting}><FileCog aria-hidden="true" />Modify mapping</Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => onDelete(row.original)} disabled={deleting} aria-label={`Delete ${row.original.originalName}`}><Trash2 aria-hidden="true" />{deletingId === row.original.id ? "Deleting…" : "Delete"}</Button>
        </div>
      ),
    },
  ], [allSelected, deleting, deletingId, onDelete, onMap, onToggle, onToggleAll, partiallySelected, selectedIds]);

  return (
    <Card id="documents" aria-labelledby="documents-heading" className="w-full gap-4">
      <CardHeader className="flex-row items-center justify-between gap-4">
        <CardTitle id="documents-heading" className="text-lg">Select files</CardTitle>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant="secondary">{selectedCount} selected</Badge>
          <Button variant="destructive" size="sm" onClick={onDeleteSelected} disabled={!selectedCount || deleting}>
            <Trash2 aria-hidden="true" />{bulkDeleting ? "Deleting selected…" : `Delete selected${selectedCount ? ` (${selectedCount})` : ""}`}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!documents.length ? (
          <Empty>
            <EmptyMedia variant="icon"><Inbox aria-hidden="true" /></EmptyMedia>
            <EmptyHeader><EmptyTitle>No documents uploaded</EmptyTitle><EmptyDescription>Add GST return files above to begin.</EmptyDescription></EmptyHeader>
          </Empty>
        ) : (
          <DataTable
            columns={columns}
            data={documents}
            getRowId={(document) => String(document.id)}
            rowSelection={rowSelection}
            enableRowSelection
            aria-label="Uploaded documents"
            className="border-y border-border"
            tableClassName="min-w-[1180px]"
          />
        )}
      </CardContent>
    </Card>
  );
}
