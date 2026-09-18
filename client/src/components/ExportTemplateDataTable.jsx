import { useCallback, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  filterFns,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { period } from "../utils/format.js";
import Notice from "./Notice.jsx";

const EMPTY_ROWS = [];
const features = tableFeatures({
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns,
});
const columnHelper = createColumnHelper();

function normalizeDocumentType(value) {
  return String(value || "").toLowerCase().replace(/[\s_-]+/g, "");
}

function documentTypeMatches(column, filterValue) {
  const normalizedFilter = normalizeDocumentType(filterValue);
  if (!normalizedFilter) return true;

  return normalizeDocumentType(`${column.documentTypeLabel || ""} ${column.documentType || ""}`).includes(normalizedFilter);
}

function displayNumber(value) {
  if (value === null || value === undefined || value === "") return "0";
  return String(value);
}

function buildSheets(rows) {
  const sheetMap = new Map();

  rows.forEach((row, rowIndex) => {
    const sheetKey = row.sheetKey || row.templateTable || "export";
    let sheet = sheetMap.get(sheetKey);

    if (!sheet) {
      sheet = {
        id: sheetKey,
        label: row.templateTable || sheetKey,
        columns: new Map(),
        rows: new Map(),
      };
      sheetMap.set(sheetKey, sheet);
    }

    const columnId = `${sheetKey}:${row.columnIndex ?? row.columnKey ?? row.field}`;
    if (!sheet.columns.has(columnId)) {
      sheet.columns.set(columnId, {
        id: columnId,
        columnIndex: row.columnIndex ?? rowIndex,
        documentType: row.documentType || "",
        documentTypeLabel: row.documentTypeLabel || row.documentType || "",
        field: row.field || "Value",
      });
    }

    const periodKey = row.returnPeriod || "period";
    let periodRow = sheet.rows.get(periodKey);
    if (!periodRow) {
      periodRow = {
        id: `${sheetKey}:${periodKey}`,
        returnPeriod: periodKey,
        documentTypeIndex: "",
        cells: {},
      };
      sheet.rows.set(periodKey, periodRow);
    }

    periodRow.cells[columnId] = row;
    periodRow.documentTypeIndex = Array.from(sheet.columns.values())
      .map((column) => `${column.documentTypeLabel} ${column.documentType}`)
      .join(" ");
  });

  return Array.from(sheetMap.values()).map((sheet) => ({
    ...sheet,
    columns: Array.from(sheet.columns.values()).sort((left, right) => left.columnIndex - right.columnIndex),
    rows: Array.from(sheet.rows.values()),
  }));
}

function EditableValueInput({ cell, onAmend }) {
  if (!cell) {
    return (
      <Input
        className="h-8 text-right font-mono text-xs tabular-nums"
        value=""
        placeholder="0"
        aria-label="No value"
        readOnly
      />
    );
  }

  return (
    <Input
      className="h-8 text-right font-mono text-xs tabular-nums placeholder:text-muted-foreground/80"
      type="number"
      step="0.01"
      inputMode="decimal"
      value={cell.amendment ?? ""}
      placeholder={displayNumber(cell.value)}
      aria-label={`Amend ${cell.field} for ${period(cell.returnPeriod)}`}
      onChange={(event) => onAmend(cell.id, event.target.value)}
    />
  );
}

function ExportTemplateSheet({ sheet, columnFilters, documentTypeFilter, onColumnFiltersChange, onAmend }) {
  const visibleTemplateColumns = useMemo(
    () => sheet.columns.filter((column) => documentTypeMatches(column, documentTypeFilter)),
    [documentTypeFilter, sheet.columns],
  );

  const columns = useMemo(() => columnHelper.columns([
    columnHelper.accessor("documentTypeIndex", {
      id: "documentType",
      filterFn: "includesString",
      header: "Document type filter",
      cell: ({ getValue }) => getValue(),
    }),
    columnHelper.accessor("returnPeriod", {
      id: "returnPeriod",
      header: "Period",
      cell: ({ getValue }) => period(getValue()),
    }),
    ...visibleTemplateColumns.map((templateColumn) => columnHelper.accessor(
      (row) => row.cells[templateColumn.id],
      {
        id: templateColumn.id,
        header: () => (
          <div className="flex min-w-36 flex-col gap-1">
            <Badge variant="outline" data-kind="document-type" className="w-fit">
              {templateColumn.documentTypeLabel}
            </Badge>
            <span className="text-xs font-normal text-muted-foreground">{templateColumn.field}</span>
          </div>
        ),
        cell: ({ getValue }) => <EditableValueInput cell={getValue()} onAmend={onAmend} />,
      },
    )),
  ]), [onAmend, visibleTemplateColumns]);

  const table = useTable({
    features,
    columns,
    data: sheet.rows,
    state: { columnFilters },
    onColumnFiltersChange,
    getRowId: (row) => row.id,
  });

  const visibleRows = table.getRowModel().rows;
  const renderableColumnCount = Math.max(visibleTemplateColumns.length + 1, 1);

  return (
    <section className="space-y-3" aria-label={sheet.label}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-normal text-foreground">{sheet.label}</h3>
        <Badge variant="secondary">{visibleTemplateColumns.length} columns</Badge>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <Table aria-label={`${sheet.label} editable spreadsheet data`} className="min-w-[980px]">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers
                  .filter((header) => header.column.id !== "documentType")
                  .map((header) => (
                    <TableHead
                      key={header.id}
                      className={cn(header.column.id === "returnPeriod" ? "sticky left-0 z-10 min-w-32 bg-background" : "align-top")}
                    >
                      {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                    </TableHead>
                  ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {visibleRows.map((row) => (
              <TableRow
                key={row.id}
                className={cn(
                  Object.values(row.original.cells).some((cell) => cell?.amended) && "bg-warning/10 hover:bg-warning/15",
                )}
              >
                {row.getAllCells()
                  .filter((cell) => cell.column.id !== "documentType")
                  .map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        cell.column.id === "returnPeriod" ? "sticky left-0 z-10 bg-background font-normal" : "min-w-40",
                      )}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
              </TableRow>
            ))}
            {!visibleRows.length || !visibleTemplateColumns.length ? (
              <TableRow>
                <TableCell colSpan={renderableColumnCount} className="h-24 text-center text-muted-foreground">
                  No cells match this document type filter.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

export default function ExportTemplateDataTable({ rows = EMPTY_ROWS, loading, error, scopeLabel, onRowsChange, onRetry }) {
  const [columnFilters, setColumnFilters] = useState([]);

  const updateRows = useCallback((updater) => {
    if (onRowsChange) onRowsChange(updater);
  }, [onRowsChange]);

  const handleAmend = useCallback((rowId, amendment) => {
    updateRows((current) => current.map((item) => (
      item.id === rowId
        ? { ...item, amendment, amended: String(amendment).trim() !== "" }
        : item
    )));
  }, [updateRows]);

  const sheets = useMemo(() => buildSheets(rows), [rows]);
  const documentTypeFilter = columnFilters.find((filter) => filter.id === "documentType")?.value ?? "";
  const amendedCount = rows.filter((row) => row.amended && String(row.amendment ?? "").trim() !== "").length;

  return (
    <Card aria-labelledby="template-data-heading" className="gap-4">
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle id="template-data-heading" className="text-base">Export template spreadsheet</CardTitle>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            These cells mirror the Excel reconciliation template for {scopeLabel || "the selected period"}. Existing values appear as placeholders; typed values override only those cells during export.
          </p>
        </div>
        <Badge variant={amendedCount ? "warning" : "secondary"}>{amendedCount ? `${amendedCount} amended` : `${rows.length} cells`}</Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        {error ? <Notice tone="danger" title="Export data could not load">{error}</Notice> : null}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid w-full max-w-sm gap-2">
            <Label htmlFor="template-document-type-filter">Filter document type</Label>
            <Input
              id="template-document-type-filter"
              value={documentTypeFilter}
              onChange={(event) => {
                const value = event.target.value;
                setColumnFilters(value ? [{ id: "documentType", value }] : []);
              }}
              placeholder="Type gstr-1, gstr-3b, sales register..."
              autoComplete="off"
            />
          </div>
          {onRetry ? (
            <Button variant="outline" type="button" onClick={onRetry} disabled={loading}>
              {loading ? <Spinner label="Refreshing export data" /> : <RefreshCw aria-hidden="true" />}
              {loading ? "Refreshing…" : "Refresh data"}
            </Button>
          ) : null}
        </div>

        {loading ? (
          <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Spinner label="Loading export template data" />Loading export template data…
          </div>
        ) : null}

        {!loading && !error && sheets.length ? (
          <div className="space-y-6">
            {sheets.map((sheet) => (
              <ExportTemplateSheet
                key={sheet.id}
                sheet={sheet}
                columnFilters={columnFilters}
                documentTypeFilter={documentTypeFilter}
                onColumnFiltersChange={setColumnFilters}
                onAmend={handleAmend}
              />
            ))}
          </div>
        ) : null}

        {!loading && !error && !rows.length ? (
          <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">No export template data is available for this selection.</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
