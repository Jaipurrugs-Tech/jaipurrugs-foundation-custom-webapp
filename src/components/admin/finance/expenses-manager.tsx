"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpFromLine, Paperclip, Pencil, Plus, TrashBin } from "@gravity-ui/icons";
import { Button, Chip, Input, Label, Modal, SearchField, Table, TextArea, TextField, toast } from "@heroui/react";
import { exportExpenses } from "@/lib/actions/exports";
import { deleteExpense, removeExpenseReceipt, saveExpense, uploadExpenseReceipt } from "@/lib/actions/finance";
import {
  EXPENSE_CATEGORIES,
  PAYMENT_MODES,
  RECEIPT_MAX_BYTES,
  RECEIPT_MIME_TYPES,
  expenseCategoryLabel,
  paymentModeLabel,
  type ExpenseCategory,
  type PaymentMode,
} from "@/lib/finance/constants";
import { resolveFinancePeriod } from "@/lib/finance/period";
import type { ExpenseRow, Option } from "@/lib/finance/queries";
import { formatPiDate, formatRupees } from "@/lib/invoices/calc";
import { todayIST } from "@/lib/visits/time";
import { OptionSelect } from "../invoices/option-select";
import { StatCard } from "../visits/stat-card";
import { ExportButton } from "../export-button";
import { ConfirmDelete } from "./confirm-delete";

const EXPENSE_PERIODS = [
  { id: "all", label: "All time" },
  { id: "fy", label: "This FY" },
  { id: "last_fy", label: "Last FY" },
  { id: "month", label: "This month" },
  { id: "custom", label: "Custom" },
] as const;

type ExpensePeriodId = (typeof EXPENSE_PERIODS)[number]["id"];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Last day of a YYYY-MM month as YYYY-MM-DD. */
function monthEnd(month: string) {
  const [year, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** The from–to dates (either may be open) of an expenses period preset, in IST. */
function expensePeriodRange(
  period: ExpensePeriodId,
  customFrom: string,
  customTo: string,
): { from: string | null; to: string | null } {
  const today = todayIST();
  switch (period) {
    case "fy": {
      // The whole Indian FY (April–March), so future-dated entries still show.
      const { from } = resolveFinancePeriod({ period: "fy" }, today);
      return { from, to: `${Number(from.slice(0, 4)) + 1}-03-31` };
    }
    case "last_fy": {
      const { from, to } = resolveFinancePeriod({ period: "last_fy" }, today);
      return { from, to };
    }
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: monthEnd(today.slice(0, 7)) };
    case "custom":
      return {
        from: DATE_PATTERN.test(customFrom) ? customFrom : null,
        to: DATE_PATTERN.test(customTo) ? customTo : null,
      };
    default:
      return { from: null, to: null };
  }
}

function ExpenseForm({
  expense,
  visitOptions,
  villageOptions,
  onSaved,
}: {
  expense: ExpenseRow | null;
  visitOptions: Option[];
  villageOptions: Option[];
  onSaved: () => void;
}) {
  const [expenseDate, setExpenseDate] = useState(expense?.expense_date ?? todayIST());
  const [category, setCategory] = useState<string>(expense?.category ?? "");
  const [description, setDescription] = useState(expense?.description ?? "");
  const [amount, setAmount] = useState(expense ? String(expense.amount) : "");
  const [paidTo, setPaidTo] = useState(expense?.paid_to ?? "");
  const [mode, setMode] = useState<string>(expense?.mode ?? "bank_transfer");
  const [reference, setReference] = useState(expense?.reference ?? "");
  const [visitId, setVisitId] = useState(expense?.visit_id ?? "");
  const [villageId, setVillageId] = useState(expense?.village_id ?? "");
  const [notes, setNotes] = useState(expense?.notes ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [removeReceipt, setRemoveReceipt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const trips = useMemo(() => {
    if (expense?.visit_id && expense.visitLabel && !visitOptions.some((o) => o.id === expense.visit_id)) {
      return [{ id: expense.visit_id, label: expense.visitLabel }, ...visitOptions];
    }
    return visitOptions;
  }, [expense, visitOptions]);

  const hasReceipt = Boolean(expense?.receipt_path) && !removeReceipt;

  function pickFile(next: File | undefined) {
    if (!next) return;
    if (!(RECEIPT_MIME_TYPES as readonly string[]).includes(next.type)) {
      setError("Upload the receipt as a PDF, PNG or JPEG.");
      return;
    }
    if (next.size > RECEIPT_MAX_BYTES) {
      setError("Keep the receipt under 5 MB.");
      return;
    }
    setError(null);
    setFile(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsPending(true);
    setError(null);
    const result = await saveExpense(expense?.id ?? null, {
      expenseDate,
      category: category as ExpenseCategory,
      description,
      amount,
      paidTo,
      mode: mode as PaymentMode,
      reference,
      visitId,
      villageId,
      notes,
    });
    if (result.error || !result.id) {
      setIsPending(false);
      setError(result.error ?? "Could not save the expense.");
      return;
    }

    if (file) {
      const form = new FormData();
      form.append("file", file);
      const upload = await uploadExpenseReceipt(result.id, form);
      if (upload.error) toast.danger(`Expense saved, but the receipt wasn't: ${upload.error}`);
    } else if (removeReceipt && expense?.receipt_path) {
      const removed = await removeExpenseReceipt(result.id);
      if (removed.error) toast.danger(removed.error);
    }
    setIsPending(false);
    onSaved();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 gap-3">
        <TextField isRequired value={expenseDate} onChange={setExpenseDate}>
          <Label>Date</Label>
          <Input type="date" />
        </TextField>
        <TextField isRequired value={amount} onChange={setAmount}>
          <Label>Amount (₹)</Label>
          <Input min={0} step="0.01" type="number" />
        </TextField>
      </div>
      <OptionSelect
        isRequired
        label="Category"
        options={EXPENSE_CATEGORIES}
        placeholder="Choose a category"
        value={category}
        onChange={setCategory}
      />
      <TextField isRequired value={description} onChange={setDescription}>
        <Label>Description</Label>
        <Input placeholder="e.g. Tempo hire, Jaipur → Manpura" />
      </TextField>
      <div className="grid grid-cols-2 gap-3">
        <TextField value={paidTo} onChange={setPaidTo}>
          <Label>Paid to</Label>
          <Input placeholder="Vendor or person" />
        </TextField>
        <OptionSelect isRequired label="Mode" options={PAYMENT_MODES} value={mode} onChange={setMode} />
      </div>
      <TextField value={reference} onChange={setReference}>
        <Label>Reference</Label>
        <Input placeholder="Bill no. / UTR" />
      </TextField>
      <OptionSelect label="Trip" noneLabel="Not linked to a trip" options={trips} value={visitId} onChange={setVisitId} />
      <OptionSelect label="Village" noneLabel="No village" options={villageOptions} value={villageId} onChange={setVillageId} />
      <TextField value={notes} onChange={setNotes}>
        <Label>Notes</Label>
        <TextArea placeholder="Optional" rows={2} />
      </TextField>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Receipt</span>
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
            {file || hasReceipt ? "Replace receipt" : "Attach receipt"}
          </Button>
          {file ? (
            <span className="max-w-56 truncate text-xs text-muted">{file.name}</span>
          ) : hasReceipt ? (
            <>
              {expense?.receiptUrl ? (
                <a className="text-xs underline" href={expense.receiptUrl} rel="noreferrer" target="_blank">
                  View current receipt
                </a>
              ) : (
                <span className="text-xs text-muted">Receipt attached</span>
              )}
              <Button size="sm" variant="ghost" onPress={() => setRemoveReceipt(true)}>
                Remove
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted">PDF, PNG or JPEG, up to 5 MB</span>
          )}
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Button fullWidth isPending={isPending} type="submit">
        {expense ? "Save changes" : "Add expense"}
      </Button>
    </form>
  );
}

export function ExpensesManager({
  expenses,
  visitOptions,
  villageOptions,
}: {
  expenses: ExpenseRow[];
  visitOptions: Option[];
  villageOptions: Option[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [period, setPeriod] = useState<ExpensePeriodId>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [tripId, setTripId] = useState("");
  const [villageId, setVillageId] = useState("");
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ExpenseRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const range = useMemo(() => expensePeriodRange(period, customFrom, customTo), [period, customFrom, customTo]);

  // The picker's recent trips, plus any older trip an expense is linked to.
  const tripOptions = useMemo(() => {
    const known = new Set(visitOptions.map((o) => o.id));
    const extra = new Map<string, string>();
    for (const e of expenses) {
      if (e.visit_id && e.visitLabel && !known.has(e.visit_id)) extra.set(e.visit_id, e.visitLabel);
    }
    return [...visitOptions, ...[...extra].map(([id, label]) => ({ id, label }))];
  }, [expenses, visitOptions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return expenses.filter(
      (e) =>
        (!category || e.category === category) &&
        (!range.from || e.expense_date >= range.from) &&
        (!range.to || e.expense_date <= range.to) &&
        (!tripId || e.visit_id === tripId) &&
        (!villageId || e.village_id === villageId) &&
        (!q ||
          [e.description, e.paid_to ?? "", e.reference ?? "", e.visitLabel ?? "", e.villageName ?? "", e.notes ?? ""].some(
            (s) => s.toLowerCase().includes(q),
          )),
    );
  }, [expenses, query, category, range, tripId, villageId]);

  const filteredTotal = filtered.reduce((s, e) => s + e.amount, 0);
  const isFiltered = Boolean(query || category || tripId || villageId || range.from || range.to);
  const thisMonth = todayIST().slice(0, 7);
  const monthTotal = expenses.filter((e) => e.expense_date.startsWith(thisMonth)).reduce((s, e) => s + e.amount, 0);
  const missingReceipts = expenses.filter((e) => !e.receipt_path).length;

  function openForm(expense: ExpenseRow | null) {
    setEditing(expense);
    setIsFormOpen(true);
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setIsDeleting(true);
    const result = await deleteExpense(pendingDelete.id);
    setIsDeleting(false);
    if (result.error) {
      toast.danger(result.error);
      return;
    }
    setPendingDelete(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="This month" value={formatRupees(monthTotal)} />
        <StatCard
          label={isFiltered ? "Matching expenses" : "All expenses"}
          value={formatRupees(filteredTotal)}
          hint={`${filtered.length} entries`}
        />
        <StatCard label="Without a receipt" value={missingReceipts} />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <SearchField aria-label="Search expenses" className="w-72" value={query} onChange={setQuery}>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Search expenses…" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <OptionSelect
            className="w-56"
            label="Category"
            noneLabel="All categories"
            options={EXPENSE_CATEGORIES}
            value={category}
            onChange={setCategory}
          />
          <OptionSelect
            className="w-64"
            label="Trip"
            noneLabel="All trips"
            options={tripOptions}
            value={tripId}
            onChange={setTripId}
          />
          <OptionSelect
            className="w-48"
            label="Village"
            noneLabel="All villages"
            options={villageOptions}
            value={villageId}
            onChange={setVillageId}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButton
            onExport={() =>
              exportExpenses({
                from: range.from ?? undefined,
                to: range.to ?? undefined,
                category: category || undefined,
                visitId: tripId || undefined,
                villageId: villageId || undefined,
              })
            }
          />
          <Button onPress={() => openForm(null)}>
            <Plus className="size-4" />
            Add expense
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <nav aria-label="Period" className="flex gap-1 rounded-xl bg-neutral-100 p-1">
          {EXPENSE_PERIODS.map((preset) => (
            <button
              key={preset.id}
              aria-pressed={preset.id === period}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                preset.id === period ? "bg-white font-medium shadow-sm" : "text-muted hover:text-foreground"
              }`}
              type="button"
              onClick={() => setPeriod(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </nav>
        {period === "custom" ? (
          <>
            <TextField className="w-44" value={customFrom} onChange={setCustomFrom}>
              <Label>From</Label>
              <Input max={customTo || undefined} type="date" />
            </TextField>
            <TextField className="w-44" value={customTo} onChange={setCustomTo}>
              <Label>To</Label>
              <Input min={customFrom || undefined} type="date" />
            </TextField>
          </>
        ) : null}
        <p className="ml-auto pb-2 text-sm text-muted">
          {filtered.length} {filtered.length === 1 ? "expense" : "expenses"} ·{" "}
          <span className="font-medium text-foreground">{formatRupees(filteredTotal)}</span>
          {range.from || range.to
            ? ` (${range.from ? formatPiDate(range.from) : "start"} – ${range.to ? formatPiDate(range.to) : "now"})`
            : ""}
        </p>
      </div>

      {expenses.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-border p-16 text-center">
          <p className="text-sm font-medium">No expenses yet</p>
          <p className="max-w-md text-sm text-muted">
            Record the foundation&apos;s costs (transport, food, guides, facilitator fees…), optionally against a trip
            or village, with the receipt attached.
          </p>
        </div>
      ) : (
        <Table>
          <Table.ScrollContainer>
            <Table.Content aria-label="Expenses" className="w-full min-w-[900px]">
              <Table.Header>
                <Table.Column isRowHeader>Date</Table.Column>
                <Table.Column>Expense</Table.Column>
                <Table.Column>Category</Table.Column>
                <Table.Column>Trip / village</Table.Column>
                <Table.Column>Mode</Table.Column>
                <Table.Column className="text-right">Amount</Table.Column>
                <Table.Column className="w-32 text-right">
                  <span className="sr-only">Actions</span>
                </Table.Column>
              </Table.Header>
              <Table.Body>
                {filtered.map((e) => (
                  <Table.Row key={e.id}>
                    <Table.Cell>{formatPiDate(e.expense_date)}</Table.Cell>
                    <Table.Cell className="font-medium">
                      {e.description}
                      {e.paid_to ? <span className="block text-xs font-normal text-muted">{e.paid_to}</span> : null}
                    </Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" variant="soft">
                        {expenseCategoryLabel(e.category)}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>
                      {e.visitLabel ? <span className="block max-w-xs truncate">{e.visitLabel}</span> : null}
                      {e.villageName ? <span className="block text-xs text-muted">{e.villageName}</span> : null}
                      {!e.visitLabel && !e.villageName ? <span className="text-muted">—</span> : null}
                    </Table.Cell>
                    <Table.Cell>
                      {paymentModeLabel(e.mode)}
                      {e.reference ? <span className="block text-xs text-muted">{e.reference}</span> : null}
                    </Table.Cell>
                    <Table.Cell className="text-right font-medium tabular-nums">{formatRupees(e.amount)}</Table.Cell>
                    <Table.Cell className="text-right">
                      {e.receiptUrl ? (
                        <a
                          aria-label="View receipt"
                          className="inline-flex size-8 items-center justify-center rounded-lg text-neutral-600 hover:bg-neutral-100"
                          href={e.receiptUrl}
                          rel="noreferrer"
                          target="_blank"
                          title="View receipt"
                        >
                          <Paperclip className="size-4" />
                        </a>
                      ) : null}
                      <Button isIconOnly aria-label="Edit expense" size="sm" variant="ghost" onPress={() => openForm(e)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button isIconOnly aria-label="Delete expense" size="sm" variant="ghost" onPress={() => setPendingDelete(e)}>
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

      {filtered.length === 0 && expenses.length > 0 ? <p className="text-center text-sm text-muted">No expenses match.</p> : null}

      <Modal.Backdrop isOpen={isFormOpen} onOpenChange={setIsFormOpen}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-lg">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{editing ? "Edit expense" : "Add expense"}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <ExpenseForm
                key={editing?.id ?? "new"}
                expense={editing}
                villageOptions={villageOptions}
                visitOptions={visitOptions}
                onSaved={() => {
                  setIsFormOpen(false);
                  router.refresh();
                }}
              />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

      <ConfirmDelete
        body="The expense and its receipt are removed. This can't be undone."
        confirmLabel="Delete expense"
        isOpen={pendingDelete !== null}
        isPending={isDeleting}
        title={`Delete “${pendingDelete?.description ?? ""}”?`}
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
