"use client";

import { useState } from "react";
import { ArrowDownToLine, Eye } from "@gravity-ui/icons";
import { Button, toast } from "@heroui/react";
import { downloadInvoicePdf, previewInvoicePdf } from "@/lib/invoices/download";

/** Preview / download buttons for a saved PI. */
export function PdfActions({
  invoiceId,
  isDisabled,
  compact = false,
}: {
  invoiceId: string;
  isDisabled?: boolean;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState<"preview" | "download" | null>(null);

  async function run(kind: "preview" | "download") {
    setBusy(kind);
    try {
      if (kind === "preview") await previewInvoicePdf(invoiceId);
      else await downloadInvoicePdf(invoiceId);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Could not create the PDF.");
    } finally {
      setBusy(null);
    }
  }

  if (compact) {
    return (
      <Button
        isIconOnly
        aria-label="Download PDF"
        isDisabled={isDisabled}
        isPending={busy === "download"}
        size="sm"
        variant="ghost"
        onPress={() => run("download")}
      >
        <ArrowDownToLine className="size-4" />
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        isDisabled={isDisabled || busy !== null}
        isPending={busy === "preview"}
        variant="secondary"
        onPress={() => run("preview")}
      >
        <Eye className="size-4" />
        Preview PDF
      </Button>
      <Button isDisabled={isDisabled || busy !== null} isPending={busy === "download"} onPress={() => run("download")}>
        <ArrowDownToLine className="size-4" />
        Download PDF
      </Button>
    </div>
  );
}
