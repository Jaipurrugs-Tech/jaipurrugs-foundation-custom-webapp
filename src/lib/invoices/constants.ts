// Fixed value sets for services and proforma invoices. The ids are what the database
// stores (see supabase/migrations/20261104130000_services_proforma_invoices.sql).

export const PRICING_UNITS = [
  { id: "per_person", label: "Per person", short: "person" },
  { id: "per_group", label: "Per group", short: "group" },
] as const;

export type PricingUnit = (typeof PRICING_UNITS)[number]["id"];

export const DISCOUNT_TYPES = [
  { id: "percent", label: "% off" },
  { id: "amount", label: "₹ off per unit" },
] as const;

export type DiscountType = (typeof DISCOUNT_TYPES)[number]["id"];

/** Only issued and paid PIs count as a visit's Rural Experience revenue. */
export const INVOICE_STATUSES = [
  { id: "draft", label: "Draft", color: "default" },
  { id: "issued", label: "Issued", color: "accent" },
  { id: "paid", label: "Paid", color: "success" },
  { id: "cancelled", label: "Cancelled", color: "danger" },
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]["id"];
export type InvoiceStatusColor = (typeof INVOICE_STATUSES)[number]["color"];

/** Statuses whose taxable value counts as the linked visit's revenue. */
export const REVENUE_STATUSES: readonly InvoiceStatus[] = ["issued", "paid"];

/** Default headcount above which discount and free guides are set by hand on the PI. */
export const DEFAULT_CUSTOM_PRICING_ABOVE = 50;

export const DEFAULT_GST_RATE = 18;

export const QR_MAX_BYTES = 2 * 1024 * 1024;
export const QR_MIME_TYPES = ["image/png", "image/jpeg"] as const;

function labelOf(list: readonly { id: string; label: string }[], id: string | null | undefined) {
  return list.find((item) => item.id === id)?.label ?? id ?? "";
}

export const pricingUnitLabel = (id: string) => labelOf(PRICING_UNITS, id);
export const invoiceStatusLabel = (id: string) => labelOf(INVOICE_STATUSES, id);

export function pricingUnitShort(id: string) {
  return PRICING_UNITS.find((u) => u.id === id)?.short ?? "unit";
}

export function invoiceStatusColor(id: string): InvoiceStatusColor {
  return INVOICE_STATUSES.find((s) => s.id === id)?.color ?? "default";
}
