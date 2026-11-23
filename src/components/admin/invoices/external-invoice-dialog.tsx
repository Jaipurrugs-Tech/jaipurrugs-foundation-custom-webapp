"use client";

import { useRef, useState } from "react";
import { ArrowUpFromLine, Sparkles } from "@gravity-ui/icons";
import { Button, Input, Label, Modal, Spinner, TextArea, TextField, toast } from "@heroui/react";
import { readProformaFile, saveExternalInvoice, uploadExternalInvoicePdf } from "@/lib/actions/invoices";
import { RECEIPT_MAX_BYTES, RECEIPT_MIME_TYPES } from "@/lib/finance/constants";
import { formatRupees, round2 } from "@/lib/invoices/calc";
import { todayIST } from "@/lib/visits/time";
import { OptionSelect } from "./option-select";

const EXTERNAL_STATUSES = [
  { id: "issued", label: "Issued (awaiting payment)" },
  { id: "paid", label: "Paid" },
  { id: "cancelled", label: "Cancelled" },
] as const;

/** An uploaded PI as the dialog edits it. */
export type ExternalInvoiceDraft = {
  id: string;
  pi_number: string;
  pi_date: string;
  billing_name: string;
  status: string;
  grand_total: number;
  gst_total: number;
  notes: string | null;
  pdf_path: string | null;
};

/** What the dialog hands back after saving, so a list can show it straight away. */
export type SavedExternalInvoice = {
  id: string;
  pi_number: string;
  pi_date: string;
  status: string;
  grand_total: number;
  taxable_total: number;
};

function ExternalInvoiceForm({
  visitId,
  visitLabel,
  invoice,
  onSaved,
}: {
  visitId: string | null;
  visitLabel: string | null;
  invoice: ExternalInvoiceDraft | null;
  onSaved: (saved: SavedExternalInvoice) => void;
}) {
  const [piNumber, setPiNumber] = useState(invoice?.pi_number ?? "");
  const [piDate, setPiDate] = useState(invoice?.pi_date ?? todayIST());
  const [billingName, setBillingName] = useState(invoice?.billing_name ?? "");
  const [status, setStatus] = useState<string>(invoice?.status ?? "issued");
  const [grandTotal, setGrandTotal] = useState(invoice ? String(invoice.grand_total) : "");
  const [gstTotal, setGstTotal] = useState(invoice ? String(invoice.gst_total) : "");
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [readNote, setReadNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const total = Number(grandTotal) || 0;
  const gst = Number(gstTotal) || 0;
  const beforeGst = total > 0 ? round2(total - gst) : null;

  async function pickFile(next: File | undefined) {
    if (!next) return;
    if (!(RECEIPT_MIME_TYPES as readonly string[]).includes(next.type)) {
      setError("Upload the PI as a PDF, PNG or JPEG.");
      return;
    }
    if (next.size > RECEIPT_MAX_BYTES) {
      setError("Keep the file under 5 MB.");
      return;
    }
    setError(null);
    setFile(next);

    setIsReading(true);
    setReadNote(null);
    const form = new FormData();
    form.append("file", next);
    const result = await readProformaFile(form);
    setIsReading(false);
    if (result.error || !result.details) {
      setReadNote({ tone: "warn", text: result.error ?? "Couldn't read the PDF. Fill the details in by hand." });
      return;
    }
    const d = result.details;
    const filled: string[] = [];
    if (d.invoiceNumber) {
      setPiNumber(d.invoiceNumber);
      filled.push("number");
    }
    if (d.invoiceDate) {
      setPiDate(d.invoiceDate);
      filled.push("date");
    }
    if (d.customerName) {
      setBillingName(d.customerName);
      filled.push("billed to");
    }
    if (d.amount !== null) {
      setGrandTotal(String(d.amount));
      filled.push("total");
    }
    // GST: as printed, else total − value before GST, else leave it for staff.
    const gstFound = d.gstAmount ?? (d.amount !== null && d.taxableAmount !== null ? round2(d.amount - d.taxableAmount) : null);
    if (gstFound !== null) {
      setGstTotal(String(gstFound));
      filled.push("GST");
    }
    const missing = [!d.invoiceNumber && "number", !d.invoiceDate && "date", d.amount === null && "total", gstFound === null && "GST"].filter(
      Boolean,
    );
    setReadNote({
      tone: missing.length ? "warn" : "ok",
      text:
        (filled.length ? `Filled from the PDF: ${filled.join(", ")}. Check before saving.` : "") +
        (missing.length ? ` Couldn't find the ${missing.join(", ")}.` : ""),
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // The dialog can open inside another form (the visit form); React bubbles submit
    // through portals, so keep this one from also submitting that.
    e.stopPropagation();
    setIsPending(true);
    setError(null);
    const result = await saveExternalInvoice(invoice?.id ?? null, {
      visitId,
      piNumber,
      piDate,
      billingName,
      status: status as "issued" | "paid" | "cancelled",
      grandTotal,
      gstTotal: gstTotal === "" ? "0" : gstTotal,
      notes,
    });
    if (result.error || !result.id) {
      setIsPending(false);
      setError(result.error ?? "Could not save the proforma invoice.");
      return;
    }
    if (file) {
      const form = new FormData();
      form.append("file", file);
      const upload = await uploadExternalInvoicePdf(result.id, form);
      if (upload.error) toast.danger(`Saved, but the PDF wasn't: ${upload.error}`);
    }
    setIsPending(false);
    onSaved({
      id: result.id,
      pi_number: piNumber.trim(),
      pi_date: piDate,
      status,
      grand_total: total,
      taxable_total: beforeGst ?? 0,
    });
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {visitLabel ? <p className="text-sm text-muted">For {visitLabel}</p> : null}

      <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-3">
        <span className="text-sm font-medium">PI PDF</span>
        <input
          ref={fileInput}
          accept={RECEIPT_MIME_TYPES.join(",")}
          className="hidden"
          type="file"
          onChange={(e) => {
            const next = e.target.files?.[0];
            e.target.value = "";
            void pickFile(next);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button isDisabled={isReading} size="sm" variant="secondary" onPress={() => fileInput.current?.click()}>
            <ArrowUpFromLine className="size-4" />
            {file || invoice?.pdf_path ? "Replace PDF" : "Upload PDF"}
          </Button>
          <span className="max-w-60 truncate text-xs text-muted">
            {file ? file.name : invoice?.pdf_path ? "A PDF is attached." : "Upload it first: the details below fill in from it."}
          </span>
        </div>
        {isReading ? (
          <p className="flex items-center gap-2 text-xs text-muted">
            <Spinner size="sm" />
            Reading the PDF…
          </p>
        ) : readNote ? (
          <p className={`flex items-start gap-1.5 text-xs ${readNote.tone === "ok" ? "text-success" : "text-warning"}`}>
            <Sparkles className="mt-0.5 size-3.5 shrink-0" />
            {readNote.text.trim()}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <TextField isRequired value={piNumber} onChange={setPiNumber}>
          <Label>PI number</Label>
          <Input placeholder="As printed" />
        </TextField>
        <TextField isRequired value={piDate} onChange={setPiDate}>
          <Label>PI date</Label>
          <Input type="date" />
        </TextField>
      </div>
      <TextField isRequired value={billingName} onChange={setBillingName}>
        <Label>Billed to</Label>
        <Input placeholder="Client name" />
      </TextField>
      <div className="grid grid-cols-2 gap-3">
        <TextField isRequired value={grandTotal} onChange={setGrandTotal}>
          <Label>Total (₹, incl. GST)</Label>
          <Input min={0} step="0.01" type="number" />
        </TextField>
        <TextField value={gstTotal} onChange={setGstTotal}>
          <Label>GST (₹)</Label>
          <Input min={0} placeholder="0" step="0.01" type="number" />
        </TextField>
      </div>
      <p className="-mt-2 text-xs text-muted">
        Before GST: {beforeGst !== null ? formatRupees(beforeGst) : "—"}. This is what counts as the trip&apos;s revenue
        while the PI is issued or paid.
      </p>
      <OptionSelect isRequired label="Status" options={EXTERNAL_STATUSES} value={status} onChange={setStatus} />
      <TextField value={notes} onChange={setNotes}>
        <Label>Notes</Label>
        <TextArea placeholder="Optional" rows={2} />
      </TextField>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button fullWidth isDisabled={isReading} isPending={isPending} type="submit">
        {invoice ? "Save changes" : "Add proforma invoice"}
      </Button>
    </form>
  );
}

/** Upload (or edit) a proforma invoice made outside the platform. */
export function ExternalInvoiceDialog({
  isOpen,
  onOpenChange,
  visitId,
  visitLabel,
  invoice,
  onSaved,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  visitId: string | null;
  visitLabel: string | null;
  invoice: ExternalInvoiceDraft | null;
  onSaved: (saved: SavedExternalInvoice) => void;
}) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-lg">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{invoice ? "Edit uploaded proforma invoice" : "Upload an existing proforma invoice"}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            {isOpen ? (
              <ExternalInvoiceForm
                key={invoice?.id ?? visitId ?? "new"}
                invoice={invoice}
                visitId={visitId}
                visitLabel={visitLabel}
                onSaved={onSaved}
              />
            ) : null}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
