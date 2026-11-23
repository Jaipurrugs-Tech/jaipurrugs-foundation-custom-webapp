"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpFromLine, FileText, Pencil, Plus, TrashBin } from "@gravity-ui/icons";
import { Button, Input, Label, Modal, SearchField, Switch, Table, TextArea, TextField, toast } from "@heroui/react";
import { deleteTaxInvoice, removeTaxInvoicePdf, saveTaxInvoice, uploadTaxInvoicePdf } from "@/lib/actions/finance";
import {
  PAYMENT_MODES,
  RECEIPT_MAX_BYTES,
  RECEIPT_MIME_TYPES,
  paymentModeLabel,
  type PaymentMode,
} from "@/lib/finance/constants";
import { openTaxInvoicePdf } from "@/lib/finance/open-tax-invoice";
import type { Option, ProformaBalance, TaxInvoiceRow } from "@/lib/finance/queries";
import { formatPiDate, formatRupees } from "@/lib/invoices/calc";
import { todayIST } from "@/lib/visits/time";
import { InvoiceStatusChip } from "../invoices/invoice-status-chip";
import { OptionSelect } from "../invoices/option-select";
import { StatCard } from "../visits/stat-card";
import { ConfirmDelete } from "./confirm-delete";

/** What the form opens with: an existing tax invoice, or a new one for a trip and/or PI. */
type FormTarget = { taxInvoice: TaxInvoiceRow | null; visitId: string | null; proformaId: string | null };

function TaxInvoiceForm({
  target,
  proformas,
  visitOptions,
  onSaved,
}: {
  target: FormTarget;
  proformas: ProformaBalance[];
  visitOptions: Option[];
  onSaved: () => void;
}) {
  const { taxInvoice } = target;
  const startProforma = proformas.find((p) => p.id === (taxInvoice?.proforma_invoice_id ?? target.proformaId));
  const [visitId, setVisitId] = useState(taxInvoice?.visit_id ?? target.visitId ?? startProforma?.visitId ?? "");
  const [proformaId, setProformaId] = useState(taxInvoice?.proforma_invoice_id ?? target.proformaId ?? "");
  const [invoiceNumber, setInvoiceNumber] = useState(taxInvoice?.invoice_number ?? "");
  const [invoiceDate, setInvoiceDate] = useState(taxInvoice?.invoice_date ?? todayIST());
  const [amount, setAmount] = useState(
    taxInvoice ? String(taxInvoice.amount) : startProforma?.balance ? String(startProforma.balance) : "",
  );
  const [mode, setMode] = useState<string>(taxInvoice?.mode ?? "bank_transfer");
  const [reference, setReference] = useState(taxInvoice?.reference ?? "");
  const [notes, setNotes] = useState(taxInvoice?.notes ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [removePdf, setRemovePdf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Keep the linked trip selectable even when it's older than the picker's list.
  const trips = useMemo(() => {
    if (taxInvoice && !visitOptions.some((o) => o.id === taxInvoice.visit_id)) {
      return [{ id: taxInvoice.visit_id, label: taxInvoice.visitLabel }, ...visitOptions];
    }
    if (startProforma?.visitId && startProforma.visitLabel && !visitOptions.some((o) => o.id === startProforma.visitId)) {
      return [{ id: startProforma.visitId, label: startProforma.visitLabel }, ...visitOptions];
    }
    return visitOptions;
  }, [taxInvoice, startProforma, visitOptions]);

  // PIs that can settle against this trip: its own, or ones not tied to any trip.
  const proformaOptions = useMemo(() => {
    const list = proformas
      .filter((p) => p.id === proformaId || !visitId || p.visitId === visitId || p.visitId === null)
      .map((p) => ({
        id: p.id,
        label: `${p.piNumber} · ${p.billingName}`,
        muted: p.balance > 0 ? `${formatRupees(p.balance)} due` : "paid",
      }));
    if (taxInvoice?.proforma_invoice_id && taxInvoice.piNumber && !list.some((o) => o.id === taxInvoice.proforma_invoice_id)) {
      list.unshift({ id: taxInvoice.proforma_invoice_id, label: taxInvoice.piNumber, muted: "" });
    }
    return list;
  }, [proformas, proformaId, visitId, taxInvoice]);

  const hasPdf = Boolean(taxInvoice?.pdf_path) && !removePdf;

  function pickFile(next: File | undefined) {
    if (!next) return;
    if (!(RECEIPT_MIME_TYPES as readonly string[]).includes(next.type)) {
      setError("Upload the invoice as a PDF, PNG or JPEG.");
      return;
    }
    if (next.size > RECEIPT_MAX_BYTES) {
      setError("Keep the file under 5 MB.");
      return;
    }
    setError(null);
    setFile(next);
  }

  function chooseProforma(id: string) {
    setProformaId(id);
    const pi = proformas.find((p) => p.id === id);
    if (pi?.visitId && !visitId) setVisitId(pi.visitId);
    if (pi && !taxInvoice && pi.balance > 0) setAmount(String(pi.balance));
  }

  function chooseTrip(id: string) {
    setVisitId(id);
    // A PI from another trip can't stay linked.
    const pi = proformas.find((p) => p.id === proformaId);
    if (pi?.visitId && pi.visitId !== id) setProformaId("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsPending(true);
    setError(null);
    const result = await saveTaxInvoice(taxInvoice?.id ?? null, {
      visitId,
      proformaInvoiceId: proformaId,
      invoiceNumber,
      invoiceDate,
      amount,
      mode: mode as PaymentMode,
      reference,
      notes,
    });
    if (result.error || !result.id) {
      setIsPending(false);
      setError(result.error ?? "Could not save the tax invoice.");
      return;
    }
    if (file) {
      const form = new FormData();
      form.append("file", file);
      const upload = await uploadTaxInvoicePdf(result.id, form);
      if (upload.error) toast.danger(`Tax invoice saved, but the PDF wasn't: ${upload.error}`);
    } else if (removePdf && taxInvoice?.pdf_path) {
      const removed = await removeTaxInvoicePdf(result.id);
      if (removed.error) toast.danger(removed.error);
    }
    setIsPending(false);
    onSaved();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <OptionSelect isRequired label="Trip" options={trips} placeholder="Choose the trip" value={visitId} onChange={chooseTrip} />
      <OptionSelect
        label="Proforma invoice it settles"
        noneLabel="Not linked to a PI"
        options={proformaOptions}
        value={proformaId}
        onChange={chooseProforma}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField isRequired value={invoiceNumber} onChange={setInvoiceNumber}>
          <Label>Tax invoice no.</Label>
          <Input placeholder="As in your accounts" />
        </TextField>
        <TextField isRequired value={invoiceDate} onChange={setInvoiceDate}>
          <Label>Invoice date</Label>
          <Input type="date" />
        </TextField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TextField isRequired value={amount} onChange={setAmount}>
          <Label>Amount paid (₹, incl. GST)</Label>
          <Input min={0} step="0.01" type="number" />
        </TextField>
        <OptionSelect isRequired label="Payment mode" options={PAYMENT_MODES} value={mode} onChange={setMode} />
      </div>
      <TextField value={reference} onChange={setReference}>
        <Label>Payment reference</Label>
        <Input placeholder="UTR / cheque no." />
      </TextField>
      <TextField value={notes} onChange={setNotes}>
        <Label>Notes</Label>
        <TextArea placeholder="Optional" rows={2} />
      </TextField>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Invoice PDF</span>
        <input
          ref={fileInput}
          accept={RECEIPT_MIME_TYPES.join(",")}
          className="hidden"
          type="file"
          onChange={(e) => {
            const next = e.target.files?.[0];
            e.target.value = "";
            pickFile(next);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onPress={() => fileInput.current?.click()}>
            <ArrowUpFromLine className="size-4" />
            {file || hasPdf ? "Replace PDF" : "Upload PDF"}
          </Button>
          {file ? (
            <span className="max-w-56 truncate text-xs text-muted">{file.name}</span>
          ) : hasPdf ? (
            <Button size="sm" variant="ghost" onPress={() => setRemovePdf(true)}>
              Remove current PDF
            </Button>
          ) : (
            <span className="text-xs text-muted">PDF, PNG or JPEG, up to 5 MB</span>
          )}
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button fullWidth isPending={isPending} type="submit">
        {taxInvoice ? "Save changes" : "Add tax invoice"}
      </Button>
    </form>
  );
}

export function TaxInvoicesManager({
  proformas,
  taxInvoices,
  visitOptions,
  initialVisitId,
}: {
  proformas: ProformaBalance[];
  taxInvoices: TaxInvoiceRow[];
  visitOptions: Option[];
  /** Opens the form for this trip straight away (from the Trips grid). */
  initialVisitId: string | null;
}) {
  const router = useRouter();
  const [showPaid, setShowPaid] = useState(false);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<FormTarget | null>(
    initialVisitId ? { taxInvoice: null, visitId: initialVisitId, proformaId: null } : null,
  );
  const [pendingDelete, setPendingDelete] = useState<TaxInvoiceRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const owing = proformas.filter((p) => p.balance > 0);
  const outstanding = owing.reduce((s, p) => s + p.balance, 0);
  const shownProformas = showPaid ? proformas : owing;
  const invoicedTotal = taxInvoices.reduce((s, t) => s + t.amount, 0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return taxInvoices;
    return taxInvoices.filter((t) =>
      [t.invoice_number, t.visitLabel, t.piNumber ?? "", t.reference ?? "", t.notes ?? ""].some((s) =>
        s.toLowerCase().includes(q),
      ),
    );
  }, [taxInvoices, query]);

  function closeForm() {
    setTarget(null);
    // Drop a ?visit= link once used, so a reload doesn't reopen the form.
    if (window.location.search.includes("visit=")) window.history.replaceState(null, "", "/finance/invoices");
  }

  async function viewPdf(row: TaxInvoiceRow) {
    try {
      await openTaxInvoicePdf(row.id);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Could not open the PDF.");
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setIsDeleting(true);
    const result = await deleteTaxInvoice(pendingDelete.id);
    setIsDeleting(false);
    if (result.error) {
      toast.danger(result.error);
      return;
    }
    setPendingDelete(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label="Outstanding on proforma invoices"
          value={formatRupees(outstanding)}
          hint={`${owing.length} PI${owing.length === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Tax invoices recorded"
          value={formatRupees(invoicedTotal)}
          hint={`${taxInvoices.length} invoice${taxInvoices.length === 1 ? "" : "s"}`}
        />
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Tax invoices</h2>
          <div className="flex flex-wrap items-center gap-3">
            <SearchField aria-label="Search tax invoices" className="w-72" value={query} onChange={setQuery}>
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Search number, trip, PI…" />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <Button onPress={() => setTarget({ taxInvoice: null, visitId: null, proformaId: null })}>
              <Plus className="size-4" />
              Add tax invoice
            </Button>
          </div>
        </div>
        {taxInvoices.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-border p-12 text-center">
            <p className="text-sm font-medium">No tax invoices yet</p>
            <p className="max-w-md text-sm text-muted">
              Once a client has paid for a trip, add the tax invoice from your accounts here with its PDF. It shows on
              the trip in Trips.
            </p>
          </div>
        ) : (
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Tax invoices" className="w-full min-w-[900px]">
                <Table.Header>
                  <Table.Column isRowHeader>Tax invoice</Table.Column>
                  <Table.Column>Trip</Table.Column>
                  <Table.Column>Proforma</Table.Column>
                  <Table.Column>Payment</Table.Column>
                  <Table.Column className="text-right">Amount</Table.Column>
                  <Table.Column className="w-32 text-right">
                    <span className="sr-only">Actions</span>
                  </Table.Column>
                </Table.Header>
                <Table.Body>
                  {filtered.map((t) => (
                    <Table.Row key={t.id}>
                      <Table.Cell className="font-medium">
                        {t.invoice_number}
                        <span className="block text-xs font-normal text-muted">{formatPiDate(t.invoice_date)}</span>
                      </Table.Cell>
                      <Table.Cell>
                        <Link className="block max-w-xs truncate hover:underline" href={`/trips?visit=${t.visit_id}`}>
                          {t.visitLabel}
                        </Link>
                        {t.notes ? <span className="block max-w-xs truncate text-xs text-muted">{t.notes}</span> : null}
                      </Table.Cell>
                      <Table.Cell>
                        {t.proforma_invoice_id && t.piNumber ? (
                          <Link className="hover:underline" href={`/invoices/${t.proforma_invoice_id}`}>
                            {t.piNumber}
                          </Link>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        {paymentModeLabel(t.mode)}
                        {t.reference ? <span className="block text-xs text-muted">{t.reference}</span> : null}
                      </Table.Cell>
                      <Table.Cell className="text-right font-medium tabular-nums">{formatRupees(t.amount)}</Table.Cell>
                      <Table.Cell className="text-right">
                        {t.pdf_path ? (
                          <Button isIconOnly aria-label="View PDF" size="sm" variant="ghost" onPress={() => viewPdf(t)}>
                            <FileText className="size-4" />
                          </Button>
                        ) : null}
                        <Button
                          isIconOnly
                          aria-label="Edit tax invoice"
                          size="sm"
                          variant="ghost"
                          onPress={() => setTarget({ taxInvoice: t, visitId: null, proformaId: null })}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button isIconOnly aria-label="Delete tax invoice" size="sm" variant="ghost" onPress={() => setPendingDelete(t)}>
                          <TrashBin className="size-4 text-danger" />
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        )}
        {filtered.length === 0 && taxInvoices.length > 0 ? (
          <p className="text-center text-sm text-muted">No tax invoices match.</p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              {showPaid ? "Issued proforma invoices" : "Proforma invoices awaiting payment"}
            </h2>
            <p className="text-xs text-muted">A PI turns Paid once the tax invoices linked to it cover its total.</p>
          </div>
          <Switch isSelected={showPaid} onChange={setShowPaid}>
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <span className="text-sm">Show fully paid</span>
            </Switch.Content>
          </Switch>
        </div>
        {shownProformas.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted">
            {proformas.length === 0 ? "No issued proforma invoices." : "Nothing outstanding."}
          </p>
        ) : (
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Proforma invoices and balances" className="w-full min-w-[820px]">
                <Table.Header>
                  <Table.Column isRowHeader>PI</Table.Column>
                  <Table.Column>Client</Table.Column>
                  <Table.Column>Status</Table.Column>
                  <Table.Column className="text-right">Total</Table.Column>
                  <Table.Column className="text-right">Invoiced</Table.Column>
                  <Table.Column className="text-right">Balance</Table.Column>
                  <Table.Column className="w-40 text-right">
                    <span className="sr-only">Actions</span>
                  </Table.Column>
                </Table.Header>
                <Table.Body>
                  {shownProformas.map((p) => (
                    <Table.Row key={p.id}>
                      <Table.Cell className="font-medium">
                        <Link className="hover:underline" href={`/invoices/${p.id}`}>
                          {p.piNumber}
                        </Link>
                        <span className="block text-xs font-normal text-muted">{formatPiDate(p.piDate)}</span>
                      </Table.Cell>
                      <Table.Cell>
                        {p.billingName}
                        {p.visitLabel ? <span className="block max-w-xs truncate text-xs text-muted">{p.visitLabel}</span> : null}
                      </Table.Cell>
                      <Table.Cell>
                        <InvoiceStatusChip status={p.status} />
                      </Table.Cell>
                      <Table.Cell className="text-right tabular-nums">{formatRupees(p.grandTotal)}</Table.Cell>
                      <Table.Cell className="text-right tabular-nums">{formatRupees(p.received)}</Table.Cell>
                      <Table.Cell className={`text-right font-medium tabular-nums ${p.balance > 0 ? "text-warning" : ""}`}>
                        {formatRupees(p.balance)}
                      </Table.Cell>
                      <Table.Cell className="text-right">
                        {p.balance > 0 ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            onPress={() => setTarget({ taxInvoice: null, visitId: p.visitId, proformaId: p.id })}
                          >
                            Add tax invoice
                          </Button>
                        ) : null}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        )}
      </section>

      <Modal.Backdrop isOpen={target !== null} onOpenChange={(open) => !open && closeForm()}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-lg">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{target?.taxInvoice ? "Edit tax invoice" : "Add tax invoice"}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {target ? (
                <TaxInvoiceForm
                  key={target.taxInvoice?.id ?? `${target.visitId ?? ""}:${target.proformaId ?? ""}`}
                  proformas={proformas}
                  target={target}
                  visitOptions={visitOptions}
                  onSaved={() => {
                    closeForm();
                    router.refresh();
                  }}
                />
              ) : null}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <ConfirmDelete
        body="The tax invoice and its PDF are removed. If it was linked to a PI, that PI's balance goes back up."
        confirmLabel="Delete tax invoice"
        isOpen={pendingDelete !== null}
        isPending={isDeleting}
        title={`Delete tax invoice ${pendingDelete?.invoice_number ?? ""}?`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
