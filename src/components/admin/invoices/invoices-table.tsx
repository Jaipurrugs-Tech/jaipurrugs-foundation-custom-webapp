"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Plus, TrashBin } from "@gravity-ui/icons";
import { AlertDialog, Button, SearchField, Table, toast } from "@heroui/react";
import { deleteInvoice, setInvoiceStatus } from "@/lib/actions/invoices";
import { formatPiDate, formatRupees } from "@/lib/invoices/calc";
import { INVOICE_STATUSES, REVENUE_STATUSES, type InvoiceStatus } from "@/lib/invoices/constants";
import type { InvoiceListItem } from "@/lib/invoices/types";
import { OptionSelect } from "./option-select";
import { InvoiceStatusMenu } from "./invoice-status-chip";
import { PdfActions } from "./pdf-actions";

export function InvoicesTable({ invoices }: { invoices: InvoiceListItem[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [pendingDelete, setPendingDelete] = useState<InvoiceListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invoices.filter(
      (invoice) =>
        (!status || invoice.status === status) &&
        (!q ||
          [invoice.pi_number, invoice.billing_name, invoice.visitLabel ?? ""].some((text) =>
            text.toLowerCase().includes(q),
          )),
    );
  }, [invoices, query, status]);

  const totals = useMemo(() => {
    const counted = filtered.filter((i) => REVENUE_STATUSES.includes(i.status as InvoiceStatus));
    return {
      taxable: counted.reduce((sum, i) => sum + i.taxable_total, 0),
      gross: counted.reduce((sum, i) => sum + i.grand_total, 0),
      count: counted.length,
    };
  }, [filtered]);

  async function changeStatus(invoice: InvoiceListItem, next: string) {
    const result = await setInvoiceStatus(invoice.id, next);
    if (result.error) {
      toast.danger(result.error);
      return;
    }
    router.refresh();
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setIsDeleting(true);
    const result = await deleteInvoice(pendingDelete.id);
    setIsDeleting(false);
    if (result.error) {
      toast.danger(result.error);
      return;
    }
    setPendingDelete(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <SearchField aria-label="Search proforma invoices" className="w-72" value={query} onChange={setQuery}>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="PI number, billed to, trip…" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <OptionSelect
            hideLabel
            className="w-44"
            label="Status"
            noneLabel="All statuses"
            options={INVOICE_STATUSES}
            value={status}
            onChange={setStatus}
          />
        </div>
        <Link
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-accent-foreground hover:opacity-90"
          href="/invoices/new"
        >
          <Plus className="size-4" />
          New proforma invoice
        </Link>
      </div>

      {invoices.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-border p-16 text-center">
          <p className="text-sm font-medium">No proforma invoices yet</p>
          <p className="max-w-md text-sm text-muted">
            Create one here or from a trip (Trips → a visit → Payment). Set up Services first so lines are priced from
            their rates and group slabs.
          </p>
        </div>
      ) : (
        <>
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Proforma invoices" className="w-full min-w-[980px]">
                <Table.Header>
                  <Table.Column isRowHeader>PI number</Table.Column>
                  <Table.Column>Date</Table.Column>
                  <Table.Column>Billed to</Table.Column>
                  <Table.Column>Trip</Table.Column>
                  <Table.Column className="text-right">Before GST</Table.Column>
                  <Table.Column className="text-right">Total</Table.Column>
                  <Table.Column>Status</Table.Column>
                  <Table.Column className="w-32 text-right">
                    <span className="sr-only">Actions</span>
                  </Table.Column>
                </Table.Header>
                <Table.Body>
                  {filtered.map((invoice) => (
                    <Table.Row key={invoice.id}>
                      <Table.Cell className="font-medium">
                        <Link className="hover:underline" href={`/invoices/${invoice.id}`}>
                          {invoice.pi_number}
                        </Link>
                      </Table.Cell>
                      <Table.Cell className="tabular-nums">{formatPiDate(invoice.pi_date)}</Table.Cell>
                      <Table.Cell className="max-w-56 truncate">{invoice.billing_name}</Table.Cell>
                      <Table.Cell className="max-w-64 text-sm">
                        {invoice.visitLabel && invoice.visit_id ? (
                          <Link className="text-accent hover:underline" href={`/trips?visit=${invoice.visit_id}`}>
                            {invoice.visitLabel}
                          </Link>
                        ) : (
                          <span className="text-muted">Not linked</span>
                        )}
                      </Table.Cell>
                      <Table.Cell className="text-right tabular-nums">{formatRupees(invoice.taxable_total)}</Table.Cell>
                      <Table.Cell className="text-right font-medium tabular-nums">{formatRupees(invoice.grand_total)}</Table.Cell>
                      <Table.Cell>
                        <InvoiceStatusMenu status={invoice.status} onChange={(next) => changeStatus(invoice, next)} />
                      </Table.Cell>
                      <Table.Cell className="text-right">
                        <div className="flex justify-end">
                          <PdfActions compact invoiceId={invoice.id} />
                          <Button
                            isIconOnly
                            aria-label="Edit proforma invoice"
                            size="sm"
                            variant="ghost"
                            onPress={() => router.push(`/invoices/${invoice.id}`)}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            isIconOnly
                            aria-label="Delete proforma invoice"
                            size="sm"
                            variant="ghost"
                            onPress={() => setPendingDelete(invoice)}
                          >
                            <TrashBin className="size-4 text-danger" />
                          </Button>
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
          {filtered.length === 0 ? (
            <p className="text-center text-sm text-muted">No proforma invoices match.</p>
          ) : (
            <p className="text-right text-sm text-muted">
              {totals.count} issued / paid in this list: {formatRupees(totals.taxable)} before GST ·{" "}
              <span className="font-medium text-foreground">{formatRupees(totals.gross)}</span> with GST
            </p>
          )}
        </>
      )}

      <AlertDialog isOpen={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialog.Backdrop>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[440px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>Delete {pendingDelete?.pi_number}?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p>
                  The PI and its lines are removed for good, and its amount no longer counts toward its trip&apos;s
                  revenue. To keep a record, mark it Cancelled instead.
                </p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">
                  Keep it
                </Button>
                <Button isPending={isDeleting} variant="danger" onPress={handleDelete}>
                  Delete PI
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}
