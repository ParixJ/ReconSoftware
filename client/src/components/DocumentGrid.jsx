import { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

const documentGridTheme = themeQuartz.withParams({
  accentColor: "var(--primary)",
  backgroundColor: "var(--card)",
  borderColor: "var(--border)",
  browserColorScheme: "inherit",
  chromeBackgroundColor: "var(--muted)",
  foregroundColor: "var(--foreground)",
  fontFamily: "Arial, sans-serif",
  fontSize: 13,
  headerBackgroundColor: "var(--muted)",
  headerTextColor: "var(--muted-foreground)",
  oddRowBackgroundColor: "var(--card)",
  rowHoverColor: "color-mix(in srgb, var(--muted) 72%, transparent)",
  wrapperBorderRadius: 0,
});

function displayValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export default function DocumentGrid({ fields = [], rows = [] }) {
  const columnDefs = useMemo(() => [
    {
      colId: "__row_number__",
      headerName: "#",
      pinned: "left",
      lockPinned: true,
      minWidth: 64,
      maxWidth: 72,
      resizable: false,
      suppressMovable: true,
      valueGetter: ({ node }) => (node?.rowIndex ?? 0) + 1,
      cellClass: "text-muted-foreground",
    },
    ...fields.map((field, index) => ({
      colId: `source-field-${index}`,
      headerName: String(field),
      minWidth: 160,
      width: 190,
      valueGetter: ({ data }) => displayValue(data?.[field]),
      tooltipValueGetter: ({ value }) => displayValue(value),
    })),
  ], [fields]);

  const defaultColDef = useMemo(() => ({
    editable: false,
    filter: false,
    resizable: true,
    sortable: false,
    suppressHeaderMenuButton: true,
  }), []);
  const height = Math.min(Math.max(rows.length * 42 + 48, 220), 560);

  return (
    <div className="w-full overflow-hidden" style={{ height }}>
      <AgGridReact
        theme={documentGridTheme}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        rowHeight={40}
        headerHeight={42}
        enableCellTextSelection
        ensureDomOrder
        suppressCellFocus={false}
        suppressClipboardPaste
        suppressCutToClipboard
        suppressDragLeaveHidesColumns
        suppressMovableColumns
        suppressNoRowsOverlay
        animateRows={false}
      />
    </div>
  );
}

export { displayValue };
