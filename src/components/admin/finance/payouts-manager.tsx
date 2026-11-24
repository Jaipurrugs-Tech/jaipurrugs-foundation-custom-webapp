"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, TrashBin } from "@gravity-ui/icons";
import { Button, Input, Label, Modal, SearchField, Table, TextArea, TextField, toast } from "@heroui/react";
import { exportArtisanPayouts } from "@/lib/actions/exports";
import { deletePayout, savePayout } from "@/lib/actions/finance";
import { PAYMENT_MODES, paymentModeLabel, type PaymentMode } from "@/lib/finance/constants";
import type { Option, PayoutRow, PendingPayout } from "@/lib/finance/queries";
import { formatPiDate, formatRupees } from "@/lib/invoices/calc";
import { todayIST } from "@/lib/visits/time";
import { OptionSelect } from "../invoices/option-select";
import { StatCard } from "../visits/stat-card";
import { ExportButton } from "../export-button";
import { ConfirmDelete } from "./confirm-delete";

type FormTarget = { payout: PayoutRow | null; pending: PendingPayout | null };

function PayoutForm({
  target,
  visitOptions,
  villageOptions,
  onSaved,
}: {
  target: FormTarget;
  visitOptions: Option[];
  villageOptions: Option[];
  onSaved: () => void;
}) {
  const { payout, pending } = target;
  const [visitId, setVisitId] = useState(payout?.visit_id ?? pending?.visitId ?? "");
  const [villageId, setVillageId] = useState(
    payout?.village_id ?? (pending?.villageIds.length === 1 ? pending.villageIds[0] : ""),
  );
  const [payee, setPayee] = useState(payout?.payee ?? "");
  const [paidOn, setPaidOn] = useState(payout?.paid_on ?? todayIST());
  const [amount, setAmount] = useState(payout ? String(payout.amount) : pending ? String(pending.pending) : "");
  const [mode, setMode] = useState<string>(payout?.mode ?? "bank_transfer");
  const [reference, setReference] = useState(payout?.reference ?? "");
  const [notes, setNotes] = useState(payout?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  // Keep the linked trip selectable even when it's older than the picker's list.
  const trips = useMemo(() => {
    const linkedId = payout?.visit_id ?? pending?.visitId;
    const linkedLabel = payout?.visitLabel ?? pending?.label;
    if (linkedId && linkedLabel && !visitOptions.some((o) => o.id === linkedId)) {
      return [{ id: linkedId, label: linkedLabel }, ...visitOptions];
    }
    return visitOptions;
  }, [payout, pending, visitOptions]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsPending(true);
    setError(null);
    const result = await savePayout(payout?.id ?? null, {
      visitId,
      villageId,
      payee,
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
      <TextField isRequired value={payee} onChange={setPayee}>
        <Label>Paid to</Label>
        <Input placeholder="Artisan family, group or SHG" />
      </TextField>
      <OptionSelect label="Trip" noneLabel="Not linked to a trip" options={trips} value={visitId} onChange={setVisitId} />
      <OptionSelect label="Village" noneLabel="No village" options={villageOptions} value={villageId} onChange={setVillageId} />
      <div className="grid grid-cols-2 gap-3">
        <TextField isRequired value={paidOn} onChange={setPaidOn}>
          <Label>Paid on</Label>
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
        {payout ? "Save changes" : "Record payout"}
      </Button>
    </form>
  );
}

export function PayoutsManager({
  payouts,
  pending,
  visitOptions,
  villageOptions,
}: {
  payouts: PayoutRow[];
  pending: PendingPayout[];
  visitOptions: Option[];
  villageOptions: Option[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<FormTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PayoutRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const totalPending = pending.reduce((s, v) => s + v.pending, 0);
  const totalPaid = payouts.reduce((s, p) => s + p.amount, 0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return payouts;
    return payouts.filter((p) =>
      [p.payee, p.visitLabel ?? "", p.villageName ?? "", p.reference ?? "", p.notes ?? ""].some((s) =>
        s.toLowerCase().includes(q),
      ),
    );
  }, [payouts, query]);

  async function handleDelete() {
    if (!pendingDelete) return;
    setIsDeleting(true);
    const result = await deletePayout(pendingDelete.id);
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
          label="Due to artisan families"
          value={formatRupees(totalPending)}
          hint={`${pending.length} completed trip${pending.length === 1 ? "" : "s"}`}
        />
        <StatCard label="Paid out (all time)" value={formatRupees(totalPaid)} hint={`${payouts.length} payouts`} />
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Due from completed trips</h2>
            <p className="text-xs text-muted">The trip&apos;s &ldquo;amount to artisans&rdquo; less payouts linked to it.</p>
          </div>
          <Button onPress={() => setTarget({ payout: null, pending: null })}>
            <Plus className="size-4" />
            Record payout
          </Button>
        </div>
        {pending.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted">
            Nothing due. Completed trips with an amount to artisans show here until they are paid out.
          </p>
        ) : (
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Payouts due" className="w-full min-w-[760px]">
                <Table.Header>
                  <Table.Column isRowHeader>Trip</Table.Column>
                  <Table.Column>Villages</Table.Column>
                  <Table.Column className="text-right">Owed</Table.Column>
                  <Table.Column className="text-right">Paid</Table.Column>
                  <Table.Column className="text-right">Due</Table.Column>
                  <Table.Column className="w-36 text-right">
                    <span className="sr-only">Actions</span>
                  </Table.Column>
                </Table.Header>
                <Table.Body>
                  {pending.map((v) => (
                    <Table.Row key={v.visitId}>
                      <Table.Cell className="font-medium">{v.label}</Table.Cell>
                      <Table.Cell>{v.villageNames.length ? v.villageNames.join(", ") : <span className="text-muted">—</span>}</Table.Cell>
                      <Table.Cell className="text-right tabular-nums">{formatRupees(v.owed)}</Table.Cell>
                      <Table.Cell className="text-right tabular-nums">{formatRupees(v.paid)}</Table.Cell>
                      <Table.Cell className="text-right font-medium tabular-nums text-warning">{formatRupees(v.pending)}</Table.Cell>
                      <Table.Cell className="text-right">
                        <Button size="sm" variant="secondary" onPress={() => setTarget({ payout: null, pending: v })}>
                          Record payout
                        </Button>
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
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Payouts made</h2>
          <div className="flex flex-wrap items-center gap-3">
            <SearchField aria-label="Search payouts" className="w-72" value={query} onChange={setQuery}>
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Search payee, trip, village…" />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <ExportButton onExport={() => exportArtisanPayouts()} />
          </div>
        </div>
        {payouts.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted">
            No payouts recorded yet.
          </p>
        ) : (
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Payouts made" className="w-full min-w-[820px]">
                <Table.Header>
                  <Table.Column isRowHeader>Date</Table.Column>
                  <Table.Column>Paid to</Table.Column>
                  <Table.Column>Trip / village</Table.Column>
                  <Table.Column>Mode</Table.Column>
                  <Table.Column className="text-right">Amount</Table.Column>
                  <Table.Column className="w-28 text-right">
                    <span className="sr-only">Actions</span>
                  </Table.Column>
                </Table.Header>
                <Table.Body>
                  {filtered.map((p) => (
                    <Table.Row key={p.id}>
                      <Table.Cell>{formatPiDate(p.paid_on)}</Table.Cell>
                      <Table.Cell className="font-medium">
                        {p.payee}
                        {p.notes ? <span className="block max-w-xs truncate text-xs font-normal text-muted">{p.notes}</span> : null}
                      </Table.Cell>
                      <Table.Cell>
                        {p.visitLabel ? <span className="block max-w-xs truncate">{p.visitLabel}</span> : null}
                        {p.villageName ? <span className="block text-xs text-muted">{p.villageName}</span> : null}
                        {!p.visitLabel && !p.villageName ? <span className="text-muted">—</span> : null}
                      </Table.Cell>
                      <Table.Cell>
                        {paymentModeLabel(p.mode)}
                        {p.reference ? <span className="block text-xs text-muted">{p.reference}</span> : null}
                      </Table.Cell>
                      <Table.Cell className="text-right font-medium tabular-nums">{formatRupees(p.amount)}</Table.Cell>
                      <Table.Cell className="text-right">
                        <Button isIconOnly aria-label="Edit payout" size="sm" variant="ghost" onPress={() => setTarget({ payout: p, pending: null })}>
                          <Pencil className="size-4" />
                        </Button>
                        <Button isIconOnly aria-label="Delete payout" size="sm" variant="ghost" onPress={() => setPendingDelete(p)}>
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
        {filtered.length === 0 && payouts.length > 0 ? <p className="text-center text-sm text-muted">No payouts match.</p> : null}
      </section>

      <Modal.Backdrop isOpen={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-md">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{target?.payout ? "Edit payout" : "Record payout"}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {target ? (
                <PayoutForm
                  key={target.payout?.id ?? target.pending?.visitId ?? "new"}
                  target={target}
                  villageOptions={villageOptions}
                  visitOptions={visitOptions}
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
        body="The payout is removed. If it was linked to a trip, that amount shows as due again."
        confirmLabel="Delete payout"
        isOpen={pendingDelete !== null}
        isPending={isDeleting}
        title={`Delete payout to ${pendingDelete?.payee ?? ""}?`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
