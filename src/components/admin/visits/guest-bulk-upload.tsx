"use client";

import { useRef, useState } from "react";
import { ArrowDownToLine, CircleCheck, CloudArrowUpIn, FileText, TriangleExclamation, Xmark } from "@gravity-ui/icons";
import { Button, Chip, toast } from "@heroui/react";
import { importGuests, type GuestImportResult } from "@/lib/actions/visits";
import {
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
  guestTemplateCsv,
  parseGuestFile,
  validateGuestRows,
  type ParsedGuestRow,
  type ValidatedImport,
} from "@/lib/visits/guest-import";

type Loaded = { filename: string; rows: ParsedGuestRow[]; checked: ValidatedImport };

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Drag-and-drop (or click to browse) upload of a CSV / Excel (.xlsx) guest list. The file is read and
 * checked in the browser so staff can see what will happen before anything is saved.
 */
export function GuestBulkUpload({ visitId, onImported }: { visitId: string; onImported: () => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  // dragenter/dragleave also fire for child elements, so count them rather than toggling.
  const dragDepth = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<GuestImportResult | null>(null);

  function reset() {
    setLoaded(null);
    setFileError(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFile(file: File | undefined) {
    setResult(null);
    setFileError(null);
    setLoaded(null);
    if (!file) return;

    if (!/\.(csv|xlsx)$/i.test(file.name)) {
      setFileError("Upload a .csv or .xlsx file.");
      return;
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setFileError("That file is too large. Keep it under 1 MB.");
      return;
    }

    const parsed = await parseGuestFile(file);
    if (parsed.error) {
      setFileError(parsed.error);
      return;
    }
    if (parsed.rows.length > MAX_IMPORT_ROWS) {
      setFileError(`The file has ${parsed.rows.length} rows. Upload at most ${MAX_IMPORT_ROWS} at a time.`);
      return;
    }
    const checked = validateGuestRows(parsed.rows);
    if (checked.valid.length === 0 && checked.problems.length === 0) {
      setFileError("No guests found in the file.");
      return;
    }
    setLoaded({ filename: file.name, rows: parsed.rows, checked });
  }

  async function handleImport() {
    if (!loaded) return;
    setIsImporting(true);
    const res = await importGuests(visitId, loaded.rows);
    setIsImporting(false);
    setResult(res);
    if (res.error && res.added === undefined) {
      toast.danger(res.error);
      return;
    }
    setLoaded(null);
    if (inputRef.current) inputRef.current.value = "";
    toast.success(`${res.added ?? 0} guest${res.added === 1 ? "" : "s"} added`);
    await onImported();
  }

  const validCount = loaded?.checked.valid.length ?? 0;
  const problems = loaded?.checked.problems ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Columns: <span className="font-medium text-foreground">name</span>,{" "}
          <span className="font-medium text-foreground">phone</span>,{" "}
          <span className="text-foreground">email</span> (optional). Up to {MAX_IMPORT_ROWS} guests per file.
        </p>
        <Button
          size="sm"
          variant="secondary"
          onPress={() => download("guest-list-template.csv", guestTemplateCsv(), "text/csv;charset=utf-8")}
        >
          <ArrowDownToLine className="size-4" />
          Download CSV template
        </Button>
      </div>

      <div
        aria-label="Upload a guest list. Drop a CSV or Excel file here, or press Enter to browse."
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
          isDragging ? "border-accent bg-accent/10" : "border-border bg-white hover:border-accent/60"
        }`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current++;
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setIsDragging(false);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setIsDragging(false);
          void handleFile(e.dataTransfer.files?.[0]);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
      >
        <CloudArrowUpIn className="size-8 text-accent" />
        <p className="text-sm font-medium">{isDragging ? "Drop the file to upload" : "Drag and drop a CSV or Excel (.xlsx) file here"}</p>
        <p className="text-xs text-muted">or click to browse</p>
        <input
          ref={inputRef}
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          tabIndex={-1}
          type="file"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
          }}
          // Picking the same file twice should still fire onChange.
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {fileError ? (
        <p className="flex items-start gap-2 text-sm text-danger" role="alert">
          <TriangleExclamation className="mt-0.5 size-4 shrink-0" />
          {fileError}
        </p>
      ) : null}

      {loaded ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <FileText className="size-4 text-muted" />
              {loaded.filename}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Chip color="success" size="sm" variant="soft">
                {validCount} ready
              </Chip>
              {problems.length > 0 ? (
                <Chip color="danger" size="sm" variant="soft">
                  {problems.length} with problems
                </Chip>
              ) : null}
              {loaded.checked.examples > 0 ? (
                <Chip size="sm" variant="soft">
                  {loaded.checked.examples} example row{loaded.checked.examples === 1 ? "" : "s"} skipped
                </Chip>
              ) : null}
              <Button aria-label="Remove file" isIconOnly size="sm" variant="ghost" onPress={reset}>
                <Xmark className="size-4" />
              </Button>
            </div>
          </div>

          {validCount > 0 ? (
            <ul className="max-h-40 divide-y divide-border/60 overflow-y-auto rounded-lg border border-border/60 text-sm">
              {loaded.checked.valid.slice(0, 50).map((g) => (
                <li key={g.row} className="flex items-center justify-between gap-3 px-3 py-1.5">
                  <span className="truncate">{g.name}</span>
                  <span className="shrink-0 tabular-nums text-muted">{g.phone}</span>
                </li>
              ))}
              {validCount > 50 ? <li className="px-3 py-1.5 text-xs text-muted">…and {validCount - 50} more</li> : null}
            </ul>
          ) : null}

          {problems.length > 0 ? <ProblemList problems={problems} /> : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">
              Each guest is added to Leads (an existing lead with the same number is reused) and to this trip.
              {problems.length > 0 ? " Rows with problems are skipped." : ""}
            </p>
            <Button isDisabled={validCount === 0} isPending={isImporting} onPress={handleImport}>
              Import {validCount} guest{validCount === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      ) : null}

      {result && !loaded ? <ResultSummary result={result} /> : null}
    </div>
  );
}

function ProblemList({ problems }: { problems: { row: number; name: string; phone: string; reason: string }[] }) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger/5 p-3">
      <p className="mb-1 text-xs font-semibold text-danger">These rows will be skipped</p>
      <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto text-xs">
        {problems.slice(0, 100).map((p) => (
          <li key={p.row}>
            <span className="font-medium">Row {p.row}</span>
            {p.name ? ` (${p.name})` : ""}: {p.reason}
          </li>
        ))}
        {problems.length > 100 ? <li className="text-muted">…and {problems.length - 100} more</li> : null}
      </ul>
    </div>
  );
}

function ResultSummary({ result }: { result: GuestImportResult }) {
  const problems = result.problems ?? [];
  const added = result.added ?? 0;
  const existingLeads = added - (result.newLeads ?? 0);
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-success/10 p-3 text-sm">
      <p className="flex items-center gap-2 font-medium text-success">
        <CircleCheck className="size-4" />
        {added} guest{added === 1 ? "" : "s"} added to this trip
      </p>
      <ul className="list-disc pl-6 text-muted">
        <li>
          {result.newLeads ?? 0} new in Leads
          {existingLeads > 0 ? `, ${existingLeads} already in Leads (reused)` : ""}
        </li>
        {result.alreadyOnVisit ? <li>{result.alreadyOnVisit} already on this trip (left as they were)</li> : null}
        {problems.length > 0 ? <li>{problems.length} skipped</li> : null}
      </ul>
      {problems.length > 0 ? <ProblemList problems={problems} /> : null}
    </div>
  );
}
