import { useRef, useState } from "react";
import { FileJson2, FileSpreadsheet, FileText, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {useDocStore} from "../store/docStore.js";
import config from '../lib/config.js';
import Notice from './Notice.jsx';
import { ERROR_CODES } from "../api/errors.js";

export default function UploadPanel({ onUpload, uploading, progress }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const documents = useDocStore((s)=>s.documents);
  const [uploadError, setUploadError] = useState(null);
  const choose = (files) => {
    if(files.length){
      setUploadError(null)
      if((files.length>config.MAX_FILES_UPLOADED || (files.length+documents.length)>config.MAX_FILES_UPLOADED)){
        setUploadError({ code: ERROR_CODES.DOCUMENT_STORAGE_LIMIT_EXCEEDED, message: `File upload and storage exceeds the limit of ${config.MAX_FILES_UPLOADED}` });
      }else{
        onUpload(files);
      }
    }
  };
  return (
    <Card aria-labelledby="upload-heading" className="w-full gap-4">
      {uploadError?<div className="mt-4"><Notice tone="warning" title="File upload failed" onClose={() => setUploadError(null)}>{uploadError.message}</Notice></div>:null}
      <CardHeader className="flex-row items-center justify-between gap-4">
        <CardTitle id="upload-heading" className="text-lg">Add return documents</CardTitle>
        <span className="text-xs text-muted-foreground">Up to {config.MAX_FILES_UPLOADED} files · {config.MAX_UPLOAD_BYTES/1024} MB each</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className={cn(
            "flex min-h-32 w-full flex-col items-center justify-center gap-4 border border-dashed border-input bg-muted/35 p-5 text-center transition-colors sm:flex-row sm:text-left",
            dragging && "border-primary bg-primary/8",
          )}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            choose(documents.length>=config.MAX_FILES_UPLOADED?[]:event.dataTransfer.files);
          }}
        >
          <Input
            ref={inputRef}
            className="sr-only"
            type="file"
            multiple
            accept=".pdf,.xlsx,.csv,.json,application/pdf,application/json"
            onChange={(event) => {
              choose(event.target.files);
              event.target.value = "";
            }}
          />
          <span className="grid size-11 shrink-0 place-items-center bg-background text-primary"><UploadCloud className="size-6" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-foreground">{uploading ? `Uploading and extracting… ${progress}%` : "Drop GST returns or sales registers here"}</p>
            <p className="mt-1 text-xs text-muted-foreground">PDF, XLSX, CSV and JSON</p>
          </div>
          <Button variant="outline" type="button" onClick={() => inputRef.current?.click()} disabled={uploading|| documents.length>=config.MAX_FILES_UPLOADED}>{uploading ? "Processing" : "Browse files"}</Button>
        </div>
        {uploading ? <Progress value={progress} aria-label={`Upload ${progress}% complete`} /> : null}
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Supported formats">
          <span className="inline-flex items-center gap-1"><FileText className="size-3.5" aria-hidden="true" />PDF</span>
          <span className="inline-flex items-center gap-1"><FileSpreadsheet className="size-3.5" aria-hidden="true" />XLSX</span>
          <span className="inline-flex items-center gap-1"><FileSpreadsheet className="size-3.5" aria-hidden="true" />CSV</span>
          <span className="inline-flex items-center gap-1"><FileJson2 className="size-3.5" aria-hidden="true" />JSON</span>
        </div>
      </CardContent>
    </Card>
  );
}
