"use client";

import { getExternalInvoicePdfUrl } from "@/lib/actions/invoices";

/**
 * Opens an uploaded proforma invoice's PDF in a new tab. The tab is opened first,
 * synchronously, so the browser doesn't block it as a pop-up.
 */
export async function openExternalInvoicePdf(invoiceId: string) {
  const tab = window.open("", "_blank");
  const result = await getExternalInvoicePdfUrl(invoiceId);
  if (result.error || !result.url) {
    tab?.close();
    throw new Error(result.error ?? "Could not open the PDF.");
  }
  if (tab) tab.location.href = result.url;
  else window.open(result.url, "_blank");
}
