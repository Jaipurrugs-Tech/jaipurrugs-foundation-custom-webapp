"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Pencil } from "@gravity-ui/icons";
import { Button, toast } from "@heroui/react";
import { formatPiDate, formatRupees } from "@/lib/invoices/calc";
import { openExternalInvoicePdf } from "@/lib/invoices/open-external";
import type { InvoiceRow } from "@/lib/invoices/types";
import { ExternalInvoiceDialog } from "./external-invoice-dialog";
import { InvoiceStatusChip } from "./invoice-status-chip";

/** An uploaded PI's page: its details and PDF. It isn't built from services, so there's no editor. */
export function ExternalInvoiceView({ invoice, visitLabel }: { invoice: InvoiceRow; visitLabel: string | null }) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isOpening, setIsOpening] = useState(false);

  async function viewPdf() {
    setIsOpening(true);
    try {
      await openExternalInvoicePdf(invoice.id);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Could not open the PDF.");
    } finally {
      setIsOpening(false);
    }
  }

  const rows: [string, React.ReactNode][] = [
    ["PI date", formatPiDate(invoice.pi_date)],
    ["Billed to", invoice.billing_name],
    [
      "Trip",
      invoice.visit_id && visitLabel ? (
        <Link className="text-accent hover:underline" href={`/trips?visit=${invoice.visit_id}`}>
          {visitLabel}
        </Link>
      ) : (
        <span className="text-muted">Not linked</span>
      ),
    ],
    ["Before GST", formatRupees(invoice.taxable_total)],
    ["GST", formatRupees(invoice.gst_total)],
    ["Total", <span key="t" className="font-semibold">{formatRupees(invoice.grand_total)}</span>],
  ];

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <InvoiceStatusChip status={invoice.status} />
        <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-muted">Uploaded · made outside this platform</span>
      </div>
      <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-2 rounded-2xl border border-border bg-white p-4 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        {invoice.notes ? (
          <div className="contents">
            <dt className="text-muted">Notes</dt>
            <dd className="whitespace-pre-wrap">{invoice.notes}</dd>
          </div>
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button isDisabled={!invoice.pdf_path} isPending={isOpening} variant="secondary" onPress={viewPdf}>
          <Eye className="size-4" />
          {invoice.pdf_path ? "View PDF" : "No PDF attached"}
        </Button>
        <Button onPress={() => setIsEditing(true)}>
          <Pencil className="size-4" />
          Edit
        </Button>
      </div>
      <ExternalInvoiceDialog
        invoice={{
          id: invoice.id,
          pi_number: invoice.pi_number,
          pi_date: invoice.pi_date,
          billing_name: invoice.billing_name,
          status: invoice.status,
          grand_total: Number(invoice.grand_total),
          gst_total: Number(invoice.gst_total),
          notes: invoice.notes,
          pdf_path: invoice.pdf_path,
        }}
        isOpen={isEditing}
        visitId={invoice.visit_id}
        visitLabel={visitLabel}
        onOpenChange={setIsEditing}
        onSaved={() => {
          setIsEditing(false);
          router.refresh();
        }}
      />
    </div>
  );
}
