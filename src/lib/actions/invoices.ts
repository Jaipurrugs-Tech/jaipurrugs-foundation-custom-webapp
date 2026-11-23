"use server";

import { revalidatePath } from "next/cache";
import { requireActiveTeamMember } from "@/lib/auth/session";
import { RECEIPT_BUCKET, RECEIPT_MAX_BYTES, RECEIPT_MIME_TYPES } from "@/lib/finance/constants";
import { extractTaxInvoice, type ExtractedTaxInvoice } from "@/lib/finance/extract-invoice";
import { QR_MAX_BYTES, QR_MIME_TYPES } from "@/lib/invoices/constants";
import { resolveOpenAIKey } from "@/lib/openai/keys";
import {
  externalInvoiceSchema,
  invoiceSchema,
  invoiceSettingsSchema,
  invoiceStatusSchema,
  invoiceTermSchema,
  invoiceTermSnapshotSchema,
  type ExternalInvoiceInput,
  type InvoiceInput,
  type InvoiceSettingsInput,
  type InvoiceTermInput,
} from "@/lib/invoices/schemas";
import type { InvoicePdfData } from "@/lib/invoices/types";
import { blankToNull } from "@/lib/visits/schemas";
import { createClient } from "@/lib/supabase/server";

export type InvoiceActionResult = { error?: string };

const QR_BUCKET = "invoice-assets";

function revalidateInvoices() {
  revalidatePath("/invoices", "layout");
  // A visit's Rural Experience revenue is derived from its issued / paid PIs.
  revalidatePath("/trips");
  revalidatePath("/calendar");
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// Proforma invoices
// ---------------------------------------------------------------------------

/**
 * Creates (id = null) or updates a PI and its lines in one transaction. A blank PI number
 * is assigned by the database (<prefix>/<financial year>/<next sequence>). Totals are
 * computed by the database from the lines.
 */
export async function saveInvoice(id: string | null, input: InvoiceInput): Promise<InvoiceActionResult & { id?: string }> {
  const { email } = await requireActiveTeamMember();
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid proforma invoice." };
  const data = parsed.data;

  const supabase = await createClient();
  if (id) {
    // An uploaded PI has no lines: saving it here would reset its totals to zero.
    const { data: current } = await supabase.from("proforma_invoices").select("is_external").eq("id", id).maybeSingle();
    if (current?.is_external) return { error: "This proforma invoice was uploaded. Edit it from its own page instead." };
  }
  const { data: savedId, error } = await supabase.rpc("save_proforma_invoice", {
    p_id: id,
    p_invoice: {
      pi_number: blankToNull(data.piNumber),
      pi_date: data.piDate,
      status: data.status,
      visit_id: data.visitId,
      billing_name: data.billingName,
      billing_address: blankToNull(data.billingAddress),
      billing_gstin: blankToNull(data.billingGstin),
      payment_terms: blankToNull(data.paymentTerms),
      guests: data.guests,
      guides: data.guides,
      free_guides: data.freeGuides,
      terms: data.terms.map((t) => ({ title: t.title, body: t.body })),
      notes: blankToNull(data.notes),
      created_by: email,
    },
    p_items: data.items.map((item) => ({
      service_id: item.serviceId,
      description: item.description,
      details: blankToNull(item.details),
      sac_code: blankToNull(item.sacCode),
      rate: item.rate,
      quantity: item.quantity,
      discount_label: item.discountRate > 0 ? blankToNull(item.discountLabel) ?? "Discount" : null,
      discount_rate: item.discountRate,
      gst_rate: item.gstRate,
    })),
  });
  if (error || !savedId) {
    if (error?.code === "23505") return { error: "That PI number is already used. Pick another, or leave it blank." };
    if (error?.code === "P0002") return { error: "That proforma invoice no longer exists." };
    if (error?.code === "23503") return { error: "The linked trip or a chosen service no longer exists." };
    return { error: "Could not save the proforma invoice." };
  }
  revalidateInvoices();
  return { id: savedId };
}

export async function setInvoiceStatus(id: string, status: string): Promise<InvoiceActionResult> {
  await requireActiveTeamMember();
  const parsed = invoiceStatusSchema.safeParse(status);
  if (!parsed.success) return { error: "Unknown status." };
  const supabase = await createClient();
  const { error } = await supabase.from("proforma_invoices").update({ status: parsed.data }).eq("id", id);
  if (error) return { error: "Could not update the status." };
  revalidateInvoices();
  return {};
}

export async function deleteInvoice(id: string): Promise<InvoiceActionResult> {
  await requireActiveTeamMember();
  const supabase = await createClient();
  const { data: current } = await supabase.from("proforma_invoices").select("pdf_path").eq("id", id).maybeSingle();
  const { error } = await supabase.from("proforma_invoices").delete().eq("id", id);
  if (error) {
    return {
      error:
        error.code === "23503"
          ? "Tax invoices are linked to this proforma invoice. Cancel it instead, or unlink them under Finance → Invoices first."
          : "Could not delete the proforma invoice.",
    };
  }
  if (current?.pdf_path) await supabase.storage.from(RECEIPT_BUCKET).remove([current.pdf_path]);
  revalidateInvoices();
  return {};
}

/** The saved PI with the seller, bank details and QR code, ready to be drawn as a PDF. */
export async function getInvoicePdfData(id: string): Promise<InvoiceActionResult & { data?: InvoicePdfData }> {
  await requireActiveTeamMember();
  const supabase = await createClient();
  const [{ data: invoice }, { data: items }, { data: settings }] = await Promise.all([
    supabase.from("proforma_invoices").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("proforma_invoice_items")
      .select("description, details, sac_code, rate, quantity, discount_label, discount_rate, gst_rate")
      .eq("invoice_id", id)
      .order("position"),
    supabase.from("invoice_settings").select("*").maybeSingle(),
  ]);
  if (!invoice) return { error: "That proforma invoice no longer exists." };
  if (!settings) return { error: "Invoice settings are missing." };

  let qrDataUri: string | null = null;
  if (settings.upi_qr_path) {
    const { data: blob } = await supabase.storage.from(QR_BUCKET).download(settings.upi_qr_path);
    if (blob && (QR_MIME_TYPES as readonly string[]).includes(blob.type)) {
      const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
      qrDataUri = `data:${blob.type};base64,${base64}`;
    }
  }

  const terms = Array.isArray(invoice.terms)
    ? invoice.terms.flatMap((t) => {
        const parsed = invoiceTermSnapshotSchema.safeParse(t);
        return parsed.success ? [parsed.data] : [];
      })
    : [];

  return {
    data: {
      settings: {
        seller_name: settings.seller_name,
        seller_address: settings.seller_address,
        seller_phone: settings.seller_phone,
        seller_state_name: settings.seller_state_name,
        seller_state_code: settings.seller_state_code,
        seller_gstin: settings.seller_gstin,
        bank_account_name: settings.bank_account_name,
        bank_account_number: settings.bank_account_number,
        bank_ifsc: settings.bank_ifsc,
        bank_name: settings.bank_name,
        bank_address: settings.bank_address,
        footer_note: settings.footer_note,
      },
      qrDataUri,
      invoice: {
        pi_number: invoice.pi_number,
        pi_date: invoice.pi_date,
        payment_terms: invoice.payment_terms,
        billing_name: invoice.billing_name,
        billing_address: invoice.billing_address,
        billing_gstin: invoice.billing_gstin,
        taxable_total: invoice.taxable_total,
        gst_total: invoice.gst_total,
        grand_total: invoice.grand_total,
        terms,
        items: items ?? [],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Settings and the UPI QR code
// ---------------------------------------------------------------------------

export async function updateInvoiceSettings(input: InvoiceSettingsInput): Promise<InvoiceActionResult> {
  const { email } = await requireActiveTeamMember();
  const parsed = invoiceSettingsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid settings." };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("invoice_settings")
    .update({
      seller_name: d.sellerName,
      seller_address: d.sellerAddress,
      seller_phone: blankToNull(d.sellerPhone),
      seller_state_name: blankToNull(d.sellerStateName),
      seller_state_code: blankToNull(d.sellerStateCode),
      seller_gstin: blankToNull(d.sellerGstin),
      bank_account_name: blankToNull(d.bankAccountName),
      bank_account_number: blankToNull(d.bankAccountNumber),
      bank_ifsc: blankToNull(d.bankIfsc),
      bank_name: blankToNull(d.bankName),
      bank_address: blankToNull(d.bankAddress),
      number_prefix: d.numberPrefix,
      default_payment_terms: blankToNull(d.defaultPaymentTerms),
      footer_note: blankToNull(d.footerNote),
      updated_by: email,
    })
    .eq("id", true);
  if (error) return { error: "Could not save the settings." };
  revalidateInvoices();
  return {};
}

/** Uploads the UPI QR code printed on every PI into the private invoice-assets bucket. */
export async function uploadInvoiceQr(formData: FormData): Promise<InvoiceActionResult> {
  const { email } = await requireActiveTeamMember();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image first." };
  if (!(QR_MIME_TYPES as readonly string[]).includes(file.type)) return { error: "Upload the QR code as a PNG or JPEG." };
  if (file.size > QR_MAX_BYTES) return { error: "Keep the QR image under 2 MB." };

  const supabase = await createClient();
  const { data: current } = await supabase.from("invoice_settings").select("upi_qr_path").maybeSingle();
  const path = `upi-qr/${Date.now()}.${file.type === "image/png" ? "png" : "jpg"}`;
  const { error: uploadError } = await supabase.storage
    .from(QR_BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (uploadError) return { error: "Could not upload the QR code." };

  const { error } = await supabase.from("invoice_settings").update({ upi_qr_path: path, updated_by: email }).eq("id", true);
  if (error) {
    await supabase.storage.from(QR_BUCKET).remove([path]);
    return { error: "Could not save the QR code." };
  }
  if (current?.upi_qr_path && current.upi_qr_path !== path) {
    await supabase.storage.from(QR_BUCKET).remove([current.upi_qr_path]);
  }
  revalidateInvoices();
  return {};
}

export async function removeInvoiceQr(): Promise<InvoiceActionResult> {
  const { email } = await requireActiveTeamMember();
  const supabase = await createClient();
  const { data: current } = await supabase.from("invoice_settings").select("upi_qr_path").maybeSingle();
  const { error } = await supabase.from("invoice_settings").update({ upi_qr_path: null, updated_by: email }).eq("id", true);
  if (error) return { error: "Could not remove the QR code." };
  if (current?.upi_qr_path) await supabase.storage.from(QR_BUCKET).remove([current.upi_qr_path]);
  revalidateInvoices();
  return {};
}

// ---------------------------------------------------------------------------
// Terms & conditions library
// ---------------------------------------------------------------------------

export async function saveInvoiceTerm(id: string | null, input: InvoiceTermInput): Promise<InvoiceActionResult> {
  const { email } = await requireActiveTeamMember();
  const parsed = invoiceTermSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid term." };
  const supabase = await createClient();
  const row = { title: parsed.data.title, body: parsed.data.body, is_default: parsed.data.isDefault };
  if (id) {
    const { error } = await supabase.from("invoice_terms").update(row).eq("id", id);
    if (error) return { error: "Could not save the term." };
  } else {
    const { data: last } = await supabase
      .from("invoice_terms")
      .select("position")
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error } = await supabase
      .from("invoice_terms")
      .insert({ ...row, position: (last?.position ?? 0) + 1, created_by: email });
    if (error) return { error: "Could not add the term." };
  }
  revalidateInvoices();
  return {};
}

export async function setInvoiceTermActive(id: string, isActive: boolean): Promise<InvoiceActionResult> {
  await requireActiveTeamMember();
  const supabase = await createClient();
  const { error } = await supabase.from("invoice_terms").update({ is_active: isActive }).eq("id", id);
  if (error) return { error: "Could not update the term." };
  revalidateInvoices();
  return {};
}

/** PIs keep their own copy of the terms they were saved with. */
export async function deleteInvoiceTerm(id: string): Promise<InvoiceActionResult> {
  await requireActiveTeamMember();
  const supabase = await createClient();
  const { error } = await supabase.from("invoice_terms").delete().eq("id", id);
  if (error) return { error: "Could not delete the term." };
  revalidateInvoices();
  return {};
}

// ---------------------------------------------------------------------------
// Proforma invoices made outside the platform (uploaded with their PDF)
// ---------------------------------------------------------------------------

const PDF_EXTENSIONS: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };

// The model that reads uploaded invoices (OpenAI; must accept PDF and image input).
const INVOICE_READER_MODEL = process.env.INVOICE_READER_MODEL?.trim() || "gpt-5-mini";

function checkPdfFile(file: FormDataEntryValue | null): File | string {
  if (!(file instanceof File) || file.size === 0) return "Choose a file first.";
  if (!(RECEIPT_MIME_TYPES as readonly string[]).includes(file.type)) return "Upload the PI as a PDF, PNG or JPEG.";
  if (file.size > RECEIPT_MAX_BYTES) return "Keep the file under 5 MB.";
  return file;
}

/** Creates or updates an uploaded PI. Its totals are typed in (or read from the PDF), not computed. */
export async function saveExternalInvoice(
  id: string | null,
  input: ExternalInvoiceInput,
): Promise<InvoiceActionResult & { id?: string }> {
  const { email } = await requireActiveTeamMember();
  const parsed = externalInvoiceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid proforma invoice." };
  const d = parsed.data;
  const taxable = Math.round((d.grandTotal - d.gstTotal) * 100) / 100;
  const row = {
    visit_id: d.visitId,
    pi_number: d.piNumber,
    pi_date: d.piDate,
    billing_name: d.billingName,
    status: d.status,
    notes: blankToNull(d.notes),
    subtotal: taxable,
    discount_total: 0,
    taxable_total: taxable,
    gst_total: d.gstTotal,
    grand_total: d.grandTotal,
    is_external: true,
  };

  const supabase = await createClient();
  if (id) {
    const { data: current } = await supabase.from("proforma_invoices").select("is_external").eq("id", id).maybeSingle();
    if (!current?.is_external) return { error: "Only an uploaded proforma invoice can be edited here." };
  }
  const { data, error } = id
    ? await supabase.from("proforma_invoices").update(row).eq("id", id).select("id").single()
    : await supabase
        .from("proforma_invoices")
        .insert({ ...row, created_by: email })
        .select("id")
        .single();
  if (error || !data) {
    return {
      error: error?.code === "23505" ? "A proforma invoice with that number already exists." : "Could not save the proforma invoice.",
    };
  }
  revalidateInvoices();
  revalidatePath("/finance", "layout");
  return { id: data.id };
}

export async function uploadExternalInvoicePdf(invoiceId: string, formData: FormData): Promise<InvoiceActionResult> {
  await requireActiveTeamMember();
  const file = checkPdfFile(formData.get("file"));
  if (typeof file === "string") return { error: file };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("proforma_invoices")
    .select("pdf_path, is_external")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!current?.is_external) return { error: "Proforma invoice not found." };

  const path = `proforma-invoices/${invoiceId}/${Date.now()}.${PDF_EXTENSIONS[file.type]}`;
  const { error: uploadError } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (uploadError) return { error: "Could not upload the file." };

  const { error } = await supabase.from("proforma_invoices").update({ pdf_path: path }).eq("id", invoiceId);
  if (error) {
    await supabase.storage.from(RECEIPT_BUCKET).remove([path]);
    return { error: "Could not save the file." };
  }
  if (current.pdf_path && current.pdf_path !== path) await supabase.storage.from(RECEIPT_BUCKET).remove([current.pdf_path]);
  revalidateInvoices();
  return {};
}

/** A short-lived link to an uploaded PI's PDF. */
export async function getExternalInvoicePdfUrl(invoiceId: string): Promise<InvoiceActionResult & { url?: string }> {
  await requireActiveTeamMember();
  const supabase = await createClient();
  const { data } = await supabase.from("proforma_invoices").select("pdf_path").eq("id", invoiceId).maybeSingle();
  if (!data?.pdf_path) return { error: "No PDF is attached to this proforma invoice." };
  const { data: signed } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(data.pdf_path, 600);
  if (!signed?.signedUrl) return { error: "Could not open the PDF." };
  return { url: signed.signedUrl };
}

/** Reads an uploaded PI (PDF or image) so its form fills itself. Nothing is saved here. */
export async function readProformaFile(
  formData: FormData,
): Promise<InvoiceActionResult & { details?: ExtractedTaxInvoice }> {
  await requireActiveTeamMember();
  const file = checkPdfFile(formData.get("file"));
  if (typeof file === "string") return { error: file };
  const key = await resolveOpenAIKey();
  if (!key) return { error: "Reading PDFs needs an OpenAI key (Settings → Configuration). Fill the details in by hand." };
  try {
    const details = await extractTaxInvoice({
      bytes: await file.arrayBuffer(),
      mimeType: file.type,
      fileName: file.name,
      apiKey: key.key,
      model: INVOICE_READER_MODEL,
      kind: "proforma",
    });
    if (!details.isInvoice) return { error: "This file doesn't look like an invoice. Check it, or fill the details in by hand." };
    return { details };
  } catch (error) {
    console.error("[invoices] could not read the proforma invoice:", error);
    return { error: "Couldn't read the PDF automatically. Fill the details in by hand." };
  }
}
