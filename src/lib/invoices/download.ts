"use client";

import { getInvoicePdfData } from "@/lib/actions/invoices";

/** "PI/RJ/RV/2627/003" -> "PI-RJ-RV-2627-003.pdf" */
export function pdfFileName(piNumber: string) {
  return `${piNumber.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "proforma-invoice"}.pdf`;
}

/**
 * Builds the saved PI as a PDF in the browser. The PDF renderer is loaded on demand so
 * it never weighs on the pages that don't need it.
 */
async function buildPdf(invoiceId: string): Promise<{ blob: Blob; fileName: string }> {
  const result = await getInvoicePdfData(invoiceId);
  if (result.error || !result.data) throw new Error(result.error ?? "Could not load the proforma invoice.");
  const [{ pdf }, { InvoicePdfDocument }, { createElement }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("./pdf-document"),
    import("react"),
  ]);
  const blob = await pdf(createElement(InvoicePdfDocument, { data: result.data }) as Parameters<typeof pdf>[0]).toBlob();
  return { blob, fileName: pdfFileName(result.data.invoice.pi_number) };
}

export async function downloadInvoicePdf(invoiceId: string) {
  const { blob, fileName } = await buildPdf(invoiceId);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Opens the PDF in a new tab. The tab is opened first, synchronously, so it isn't blocked as a pop-up. */
export async function previewInvoicePdf(invoiceId: string) {
  const tab = window.open("", "_blank");
  try {
    const { blob } = await buildPdf(invoiceId);
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url;
    else window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (error) {
    tab?.close();
    throw error;
  }
}
