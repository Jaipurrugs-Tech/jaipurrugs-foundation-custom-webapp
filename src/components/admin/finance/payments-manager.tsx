"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Plus, TrashBin } from "@gravity-ui/icons";
import { Button, Input, Label, Modal, SearchField, Switch, Table, TextArea, TextField, toast } from "@heroui/react";
import { deletePayment, savePayment } from "@/lib/actions/finance";
import { PAYMENT_MODES, paymentModeLabel, type PaymentMode } from "@/lib/finance/constants";
import type { PaymentInvoice, PaymentRow } from "@/lib/finance/queries";
import { formatPiDate, formatRupees } from "@/lib/invoices/calc";
import { todayIST } from "@/lib/visits/time";
import { InvoiceStatusChip } from "../invoices/invoice-status-chip";
import { OptionSelect } from "../invoices/option-select";
import { StatCard } from "../visits/stat-card";
import { ConfirmDelete } from "./confirm-delete";

type FormTarget = { payment: PaymentRow | null; invoiceId: string | null };

function PaymentForm({
  target,
  invoices,
  onSaved,
}: {
  target: FormTarget;
  invoices: PaymentInvoice[];
  onSaved: () => void;
}) {
  const { payment } = target;
  const initialInvoice = payment?.invoice_id ?? target.invoiceId ?? "";
  const [invoiceId, setInvoiceId] = useState(initialInvoice);
  const [paidOn, setPaidOn] = useState(payment?.paid_on ?? todayIST());
  const [amount, setAmount] = useState(() => {
    if (payment) return String(payment.amount);
    const balance = invoices.find((i) => i.id === initialInvoice)?.balance;
    return balance ? String(balance) : "";
  });
  const [mode, setMode] = useState<string>(payment?.mode ?? "bank_transfer");
  const [reference, setReference] = useState(payment?.reference ?? "");
  const [notes, setNotes] = useState(payment?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const options = useMemo(() => {
    const list = invoices.map((i) => ({
      id: i.id,
      label: `${i.piNumber} · ${i.billingName}`,
      muted: i.balance > 0 ? `${formatRupees(i.balance)} due` : "paid",
    }));
    // A payment against a PI that has since been cancelled still needs its option.
    if (payment && !list.some((o) => o.id === payment.invoice_id)) {
      list.unshift({ id: payment.invoice_id, label: `${payment.piNumber} · ${payment.billingName}`, muted: "" });
    }
    return list;
  }, [invoices, payment]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsPending(true);
    setError(null);
    const result = await savePayment(payment?.id ?? null, {
      invoiceId,
      paidOn,
      amount,
      mode: mode as PaymentMode,
      reference,
      notes,
    });
    setIsPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSaved();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <OptionSelect
        isRequired
        label="Proforma invoice"
        options={options}
        placeholder="Choose a PI"
        value={invoiceId}
        onChange={(id) => {
          setInvoiceId(id);
          if (!payment) {
            const balance = invoices.find((i) => i.id === id)?.balance;
            if (balance) setAmount(String(balance));
          }
        }}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextField isRequired value={paidOn} onChange={setPaidOn}>
          <Label>Received on</Label>
          <Input type="date" />
        </TextField>
        <TextField isRequired value={amount} onChange={setAmount}>
          <Label>Amount (₹)</Label>
          <Input min={0} step="0.01" type="number" />
        </TextField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <OptionSelect isRequired label="Mode" options={PAYMENT_MODES} value={mode} onChange={setMode} />
        <TextField value={reference} onChange={setReference}>
          <Label>Reference</Label>
          <Input placeholder="UTR / cheque no." />
        </TextField>
      </div>
      <TextField value={notes} onChange={setNotes}>
        <Label>Notes</Label>
        <TextArea placeholder="Optional" rows={2} />
      </TextField>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button fullWidth isPending={isPending} type="submit">
        {payment ? "Save changes" : "Record payment"}
      </Button>
    </form>
  );
}

export function PaymentsManager({ invoices, payments }: { invoices: PaymentInvoice[]; payments: PaymentRow[] }) {
  const router = useRouter();
  const [showPaid, setShowPaid] = useState(false);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<FormTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PaymentRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const owing = invoices.filter((i) => i.balance > 0);
  const outstanding = owing.reduce((s, i) => s + i.balance, 0);
  const shownInvoices = showPaid ? invoices : owing;

  const filteredPayments = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter((p) =>
      [p.piNumber, p.billingName, p.reference ?? "", p.notes ?? ""].some((s) => s.toLowerCase().includes(q)),
    );
  }, [payments, query]);

  async function handleDelete() {
    if (!pendingDelete) return;
    setIsDeleting(true);
    const result = await deletePayment(pendingDelete.id);
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
          label="Outstanding"
          value={formatRupees(outstanding)}
          hint={`${owing.length} proforma invoice${owing.length === 1 ? "" : "s"}`}
        />
        <StatCard label="Payments recorded" value={payments.length} />
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            {showPaid ? "Issued proforma invoices" : "Awaiting payment"}
          </h2>
          <div className="flex items-center gap-4">
            <Switch isSelected={showPaid} onChange={setShowPaid}>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <span className="text-sm">Show fully paid</span>
              </Switch.Content>
            </Switch>
            <Button onPress={() => setTarget({ payment: null, invoiceId: null })}>
              <Plus className="size-4" />
              Record payment
            </Button>
          </div>
        </div>

        {shownInvoices.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-border p-12 text-center">
            <p className="text-sm font-medium">{invoices.length === 0 ? "No issued proforma invoices" : "Nothing outstanding"}</p>
            <p className="max-w-md text-sm text-muted">
              Payments are recorded against issued PIs. Issue one from{" "}
              <Link className="underline" href="/invoices">
                Proforma invoices
              </Link>
              .
            </p>
          </div>
        ) : (
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Proforma invoices and balances" className="w-full min-w-[820px]">
                <Table.Header>
                  <Table.Column isRowHeader>PI</Table.Column>
                  <Table.Column>Client</Table.Column>
                  <Table.Column>Status</Table.Column>
                  <Table.Column className="text-right">Total</Table.Column>
                  <Table.Column className="text-right">Received</Table.Column>
                  <Table.Column className="text-right">Balance</Table.Column>
                  <Table.Column className="w-36 text-right">
                    <span className="sr-only">Actions</span>
                  </Table.Column>
                </Table.Header>
                <Table.Body>
                  {shownInvoices.map((inv) => (
                    <Table.Row key={inv.id}>
                      <Table.Cell className="font-medium">
                        <Link className="hover:underline" href={`/invoices/${inv.id}`}>
                          {inv.piNumber}
                        </Link>
                        <span className="block text-xs font-normal text-muted">{formatPiDate(inv.piDate)}</span>
                      </Table.Cell>
                      <Table.Cell>
                        {inv.billingName}
                        {inv.visitLabel ? <span className="block max-w-xs truncate text-xs text-muted">{inv.visitLabel}</span> : null}
                      </Table.Cell>
                      <Table.Cell>
                        <InvoiceStatusChip status={inv.status} />
                      </Table.Cell>
                      <Table.Cell className="text-right tabular-nums">{formatRupees(inv.grandTotal)}</Table.Cell>
                      <Table.Cell className="text-right tabular-nums">{formatRupees(inv.received)}</Table.Cell>
                      <Table.Cell className={`text-right font-medium tabular-nums ${inv.balance > 0 ? "text-warning" : ""}`}>
                        {formatRupees(inv.balance)}
                      </Table.Cell>
                      <Table.Cell className="text-right">
                        {inv.balance > 0 ? (
                          <Button size="sm" variant="secondary" onPress={() => setTarget({ payment: null, invoiceId: inv.id })}>
                            Record payment
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

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Payments received</h2>
          <SearchField aria-label="Search payments" className="w-72" value={query} onChange={setQuery}>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search PI, client, reference…" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        </div>
        {payments.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted">
            No payments recorded yet.
          </p>
        ) : (
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Payments received" className="w-full min-w-[760px]">
                <Table.Header>
                  <Table.Column isRowHeader>Date</Table.Column>
                  <Table.Column>PI</Table.Column>
                  <Table.Column>Client</Table.Column>
                  <Table.Column>Mode</Table.Column>
                  <Table.Column className="text-right">Amount</Table.Column>
                  <Table.Column className="w-28 text-right">
                    <span className="sr-only">Actions</span>
                  </Table.Column>
                </Table.Header>
                <Table.Body>
                  {filteredPayments.map((p) => (
                    <Table.Row key={p.id}>
                      <Table.Cell>{formatPiDate(p.paid_on)}</Table.Cell>
                      <Table.Cell className="font-medium">{p.piNumber}</Table.Cell>
                      <Table.Cell>
                        {p.billingName}
                        {p.notes ? <span className="block max-w-xs truncate text-xs text-muted">{p.notes}</span> : null}
                      </Table.Cell>
                      <Table.Cell>
                        {paymentModeLabel(p.mode)}
                        {p.reference ? <span className="block text-xs text-muted">{p.reference}</span> : null}
                      </Table.Cell>
                      <Table.Cell className="text-right font-medium tabular-nums">{formatRupees(p.amount)}</Table.Cell>
                      <Table.Cell className="text-right">
                        <Button isIconOnly aria-label="Edit payment" size="sm" variant="ghost" onPress={() => setTarget({ payment: p, invoiceId: null })}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button isIconOnly aria-label="Delete payment" size="sm" variant="ghost" onPress={() => setPendingDelete(p)}>
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
        {filteredPayments.length === 0 && payments.length > 0 ? (
          <p className="text-center text-sm text-muted">No payments match.</p>
        ) : null}
      </section>

      <Modal.Backdrop isOpen={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-md">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{target?.payment ? "Edit payment" : "Record payment"}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {target ? (
                <PaymentForm
                  key={target.payment?.id ?? target.invoiceId ?? "new"}
                  invoices={invoices}
                  target={target}
                  onSaved={() => {
                    setTarget(null);
                    router.refresh();
                  }}
                />
              ) : null}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <ConfirmDelete
        body="The payment is removed and the PI's balance goes back up. A fully paid PI returns to Issued."
        confirmLabel="Delete payment"
        isOpen={pendingDelete !== null}
        isPending={isDeleting}
        title={`Delete ${pendingDelete ? formatRupees(pendingDelete.amount) : ""} payment?`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
