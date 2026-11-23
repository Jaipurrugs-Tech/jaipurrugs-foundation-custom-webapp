"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "@gravity-ui/icons";
import { Button, toast } from "@heroui/react";
import { openTaxInvoicePdf } from "@/lib/finance/open-tax-invoice";
import { formatPiDate, formatRupees } from "@/lib/invoices/calc";
import type { VisitTaxInvoice } from "@/lib/visits/types";

// Show at most this many tax invoices in a row; the rest are on Finance → Invoices.
const SHOWN = 2;

/**
 * The Trips grid's Invoice cell: the trip's tax invoices (what the client has paid).
 * A number with a PDF opens it in a new tab. HeroUI Buttons (React Aria presses), so
 * pressing them doesn't also open the visit's detail panel.
 */
export function TripInvoicesCell({ visitId, taxInvoices }: { visitId: string; taxInvoices: VisitTaxInvoice[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function view(id: string) {
    setBusy(id);
    try {
      await openTaxInvoicePdf(id);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Could not open the PDF.");
    } finally {
      setBusy(null);
    }
  }

  if (taxInvoices.length === 0) {
    return (
      <Button
        className="h-auto min-h-0 px-1.5 py-1 text-xs text-muted"
        size="sm"
        variant="ghost"
        onPress={() => router.push(`/finance/invoices?visit=${visitId}`)}
      >
        <Plus className="size-3.5" />
        Add invoice
      </Button>
    );
  }

  const hidden = taxInvoices.length - SHOWN;

  return (
    <div className="flex flex-col gap-1">
      {taxInvoices.slice(0, SHOWN).map((invoice) => (
        <div key={invoice.id} className="min-w-0">
          {invoice.pdf_path ? (
            <Button
              aria-label={`View tax invoice ${invoice.invoice_number}`}
              className="h-auto min-h-0 max-w-[180px] justify-start px-1.5 py-0.5 text-sm font-medium text-accent"
              isPending={busy === invoice.id}
              size="sm"
              variant="ghost"
              onPress={() => view(invoice.id)}
            >
              <span className="truncate">{invoice.invoice_number}</span>
            </Button>
          ) : (
            <span className="block max-w-[180px] truncate px-1.5 text-sm font-medium" title="No PDF uploaded">
              {invoice.invoice_number}
            </span>
          )}
          <span className="block whitespace-nowrap px-1.5 text-xs text-muted">
            {formatPiDate(invoice.invoice_date)} · {formatRupees(invoice.amount)}
          </span>
        </div>
      ))}
      {hidden > 0 ? <span className="px-1.5 text-xs text-muted">+{hidden} more</span> : null}
    </div>
  );
}
