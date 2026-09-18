import { tableFeatures, useTable } from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const features = tableFeatures({});

function DataTable({
  columns,
  data,
  getRowId,
  rowSelection,
  emptyMessage = "No results.",
  className,
  tableClassName,
  "aria-label": ariaLabel = "Data table",
}) {
  const table = useTable({
    features,
    columns,
    data,
    getRowId,
  });

  return (
    <div data-slot="data-table" className={cn("w-full overflow-hidden", className)}>
      <Table aria-label={ariaLabel} className={tableClassName}>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} colSpan={header.colSpan}>
                  {header.isPlaceholder
                    ? null
                    : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length > 0 ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={rowSelection?.[row.id] ? "selected" : undefined}
              >
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={Math.max(columns.length, 1)}
                className="h-28 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export { DataTable };
