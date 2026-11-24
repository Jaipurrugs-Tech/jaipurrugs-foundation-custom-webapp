"use client";

import { useState } from "react";
import { ArrowDownToLine } from "@gravity-ui/icons";
import { Button, toast } from "@heroui/react";
import type { ExportResult } from "@/lib/actions/exports";
import { downloadCsv } from "@/lib/download-csv";

/** "Export" button: runs a CSV export server action and saves the file. */
export function ExportButton({
  onExport,
  label = "Export",
  size,
}: {
  onExport: () => Promise<ExportResult>;
  label?: string;
  size?: "sm" | "md" | "lg";
}) {
  const [isPending, setIsPending] = useState(false);

  async function handlePress() {
    setIsPending(true);
    try {
      const result = await onExport();
      if ("error" in result) {
        toast.danger(result.error);
        return;
      }
      downloadCsv(result.csv, result.fileName);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : "Could not export.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button isPending={isPending} size={size} variant="secondary" onPress={handlePress}>
      <ArrowDownToLine className="size-4" />
      {label}
    </Button>
  );
}
