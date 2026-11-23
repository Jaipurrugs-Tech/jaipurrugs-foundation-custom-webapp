"use client";

import { getTaxInvoicePdfUrl } from "@/lib/actions/finance";

/**
 * Opens a tax invoice's uploaded PDF in a new tab. The tab is opened first,
 * synchronously, so the browser doesn't block it as a pop-up.
 */
export async function openTaxInvoicePdf(taxInvoiceId: string) {
  const tab = window.open("", "_blank");
  const result = await getTaxInvoicePdfUrl(taxInvoiceId);
  if (result.error || !result.url) {
    tab?.close();
    throw new Error(result.error ?? "Could not open the PDF.");
  }
  if (tab) tab.location.href = result.url;
  else window.open(result.url, "_blank");
}
