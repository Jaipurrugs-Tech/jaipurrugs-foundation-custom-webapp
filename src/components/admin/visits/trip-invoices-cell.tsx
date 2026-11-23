"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, Plus } from "@gravity-ui/icons";
import { Button, toast } from "@heroui/react";
import { formatRupees } from "@/lib/invoices/calc";
import { invoiceStatusLabel } from "@/lib/invoices/constants";
import { downloadInvoicePdf, previewInvoicePdf } from "@/lib/invoices/download";
import type { VisitInvoice } from "@/lib/visits/types";

// Show at most this many PIs in a row; the rest are in the visit's detail panel.
const SHOWN = 2;

/**
 * The Trips grid's Invoice cell: each PI's number opens its PDF in a new tab, the
 * arrow downloads it. HeroUI Buttons (React Aria presses) so pressing them doesn't
 * also open the visit's detail panel.
 */
export function TripInvoicesCell({ visitId, invoices }: { visitId: string; invoices: VisitInvoice[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(invoiceId: string, kind: "preview" | "download") {
    setBusy(`${kind}:${invoiceId}`);
    try {
      if (kind === "preview") await previewInvoicePdf(invoiceId);
      else await downloadInvoicePdf(invoiceId);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Could not create the PDF.");
    } finally {
      setBusy(null);
    }
  }

  if (invoices.length === 0) {
    return (
      <Button
        className="h-auto min-h-0 px-1.5 py-1 text-xs text-muted"
        size="sm"
        variant="ghost"
        onPress={() => router.push(`/invoices/new?visit=${visitId}`)}
      >
        <Plus className="size-3.5" />
        Raise PI
      </Button>
    );
  }

  // Newest first, so the PI that matters now is on top.
  const ordered = [...invoices].reverse();
  const hidden = ordered.length - SHOWN;

  return (
    <div className="flex flex-col gap-1">
      {ordered.slice(0, SHOWN).map((invoice) => {
        const cancelled = invoice.status === "cancelled";
        return (
          <div key={invoice.id} className="flex items-center gap-0.5">
            <div className="min-w-0">
              <Button
                aria-label={`View ${invoice.pi_number} as PDF`}
                className={`h-auto min-h-0 max-w-[180px] justify-start px-1.5 py-0.5 text-sm font-medium text-accent ${
                  cancelled ? "line-through opacity-60" : ""
                }`}
                isPending={busy === `preview:${invoice.id}`}
                size="sm"
                variant="ghost"
                onPress={() => run(invoice.id, "preview")}
              >
                <span className="truncate">{invoice.pi_number}</span>
              </Button>
              <span className="block whitespace-nowrap px-1.5 text-xs text-muted">
                {invoiceStatusLabel(invoice.status)} · {formatRupees(invoice.grand_total)}
              </span>
            </div>
            <Button
              isIconOnly
              aria-label={`Download ${invoice.pi_number}`}
              isPending={busy === `download:${invoice.id}`}
              size="sm"
              variant="ghost"
              onPress={() => run(invoice.id, "download")}
            >
              <ArrowDownToLine className="size-4 text-muted" />
            </Button>
          </div>
        );
      })}
      {hidden > 0 ? <span className="px-1.5 text-xs text-muted">+{hidden} more</span> : null}
    </div>
  );
}
