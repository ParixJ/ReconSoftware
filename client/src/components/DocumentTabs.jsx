import { lazy, Suspense } from "react";
import { AlertTriangle, FileCog, FileSearch, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TYPE_LABELS } from "../utils/format.js";

const DocumentGrid = lazy(() => import("./DocumentGrid.jsx"));

export default function DocumentTabs({ selectedDocuments, activeId, onActive, onRemove, onMap, detail, loading }) {
  return (
    <Card aria-labelledby="viewer-heading" className="w-full gap-4">
      <CardHeader><CardTitle id="viewer-heading" className="text-lg">Return document data</CardTitle></CardHeader>
      <CardContent>
        {!selectedDocuments.length ? (
          <Empty>
            <EmptyMedia variant="icon"><FileSearch aria-hidden="true" /></EmptyMedia>
            <EmptyHeader><EmptyTitle>Select documents to inspect</EmptyTitle><EmptyDescription>The selected returns will open here as file tabs.</EmptyDescription></EmptyHeader>
          </Empty>
        ) : (
          <Tabs value={String(activeId || selectedDocuments[0]?.id || "")} onValueChange={onActive} className="w-full">
            <TabsList className="h-auto max-w-full justify-start gap-1 overflow-x-auto bg-muted p-1" aria-label="Selected return files">
              {selectedDocuments.map((document) => (
                <div key={document.id} className="relative shrink-0">
                  <TabsTrigger value={String(document.id)} className="h-12 min-w-52 justify-start px-3 pr-10 text-left">
                    <span className="min-w-0">
                      <span className="block text-xs text-foreground">{TYPE_LABELS[document.documentType] || "Unknown"}</span>
                      <small className="block max-w-36 truncate text-xs text-muted-foreground" title={document.originalName}>{document.originalName}</small>
                    </span>
                  </TabsTrigger>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 size-7 -translate-y-1/2 text-muted-foreground"
                    aria-label={`Remove ${document.originalName} from selection`}
                    onClick={() => onRemove(document.id)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </TabsList>
            {selectedDocuments.map((document) => (
              <TabsContent key={document.id} value={String(document.id)} className="mt-4">
                {loading || !detail || detail.id !== document.id ? (
                  <div className="flex min-h-44 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner label="Loading extracted rows" />Loading extracted rows…</div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 bg-muted/60 p-3 text-sm">
                      <span><small className="block text-xs text-muted-foreground">Client GSTIN</small><span className="font-mono">{detail.gstin || "Not detected"}</span></span>
                      <span><small className="block text-xs text-muted-foreground">Return type</small><span>{TYPE_LABELS[detail.documentType] || "Unknown"}</span></span>
                      <span><small className="block text-xs text-muted-foreground">Rows</small><span className="tabular-nums">{Number(detail.original?.rowCount || 0).toLocaleString("en-IN")}</span></span>
                      <span><small className="block text-xs text-muted-foreground">Extraction</small><span>{detail.status === "ready" ? "Ready" : "Review mapping"}</span></span>
                      {detail.anomalies?.length ? <Badge variant="destructive" data-kind="status" className="status-warning"><AlertTriangle aria-hidden="true" />{detail.anomalies.length} extraction issue{detail.anomalies.length === 1 ? "" : "s"}</Badge> : null}
                      <Button className="ml-auto" variant="outline" size="sm" onClick={() => onMap(detail.id)}><FileCog aria-hidden="true" />Modify mapping</Button>
                    </div>
                    {!detail.original?.rows?.length ? (
                      <Empty>
                        <EmptyMedia variant="icon"><FileSearch aria-hidden="true" /></EmptyMedia>
                        <EmptyHeader><EmptyTitle>No extractable rows</EmptyTitle><EmptyDescription>Review the source or modify its mapping before reconciliation.</EmptyDescription></EmptyHeader>
                      </Empty>
                    ) : (
                      <Suspense fallback={<div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground"><Spinner label="Loading document grid" />Loading document grid…</div>}>
                        <DocumentGrid fields={detail.original.fields} rows={detail.original.rows} />
                      </Suspense>
                    )}
                  </div>
                )}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
