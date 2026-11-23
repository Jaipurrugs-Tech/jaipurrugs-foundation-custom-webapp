import type { Tables } from "@/lib/types/supabase";
import type { InvoiceTermSnapshot } from "./schemas";

export type ServiceRow = Tables<"services">;
export type ServiceSlabRow = Tables<"service_slabs">;

/** A service with its locations and headcount slabs, as the services page and PI editor use it. */
export type ServiceItem = ServiceRow & {
  villageIds: string[];
  slabs: ServiceSlabRow[];
  /** PI lines that came from this service. */
  usageCount: number;
};

export type InvoiceRow = Tables<"proforma_invoices">;
export type InvoiceItemRow = Tables<"proforma_invoice_items">;
export type InvoiceSettingsRow = Tables<"invoice_settings">;
export type InvoiceTermRow = Tables<"invoice_terms">;

/** A row in the PI list. */
export type InvoiceListItem = Pick<
  InvoiceRow,
  | "id"
  | "pi_number"
  | "pi_date"
  | "status"
  | "visit_id"
  | "billing_name"
  | "guests"
  | "taxable_total"
  | "grand_total"
  | "updated_at"
> & { visitLabel: string | null };

/** A PI with its lines, for the editor. */
export type InvoiceWithItems = InvoiceRow & { items: InvoiceItemRow[] };

/** A visit as offered in the PI editor's trip picker. */
export type InvoiceVisitOption = {
  id: string;
  label: string;
  visitDate: string | null;
  status: string;
  /** All the trip's programs (the first is its main one). */
  programCategories: string[];
  visitorCategory: string | null;
  headcount: number | null;
  source: string | null;
  villageIds: string[];
  primaryGuestName: string | null;
};

/** Everything the PDF needs. Totals come from the database (the saved PI). */
export type InvoicePdfData = {
  settings: Omit<InvoiceSettingsRow, "id" | "updated_at" | "updated_by" | "upi_qr_path" | "number_prefix" | "default_payment_terms">;
  /** The UPI QR code as a data: URI, or null when none is uploaded. */
  qrDataUri: string | null;
  invoice: Pick<
    InvoiceRow,
    | "pi_number"
    | "pi_date"
    | "payment_terms"
    | "billing_name"
    | "billing_address"
    | "billing_gstin"
    | "taxable_total"
    | "gst_total"
    | "grand_total"
  > & {
    terms: InvoiceTermSnapshot[];
    items: Pick<
      InvoiceItemRow,
      "description" | "details" | "sac_code" | "rate" | "quantity" | "discount_label" | "discount_rate" | "gst_rate"
    >[];
  };
};
