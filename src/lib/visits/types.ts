import type { Tables } from "@/lib/types/supabase";

export type VisitRow = Tables<"visits">;

export type VisitSale = Pick<Tables<"visit_sales">, "id" | "channel" | "invoice_id" | "amount">;

/** A proforma invoice linked to a visit. Issued / paid ones make up the visit's Rural Experience revenue. */
export type VisitInvoice = Pick<
  Tables<"proforma_invoices">,
  "id" | "pi_number" | "pi_date" | "status" | "taxable_total" | "grand_total"
>;

/** A visit with the relations the list and calendar views need. */
export type VisitListItem = VisitRow & {
  villageIds: string[];
  experienceIds: string[];
  guestCount: number;
  /** JR sales / JR Farms sales invoices attributed to the visit. */
  sales: VisitSale[];
  /** Proforma invoices raised for the visit (its charges are managed there). */
  invoices: VisitInvoice[];
  /** The guest marked as the visit's primary point of contact, shown in the trips grid. */
  primaryGuest: VisitPrimaryGuest | null;
};

export type VisitPrimaryGuest = {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
};

export type VillageOption = Pick<Tables<"villages">, "id" | "name" | "is_active">;
export type ExperienceOption = Pick<Tables<"experiences">, "id" | "village_id" | "name" | "is_active">;
export type PartnerOption = Pick<Tables<"partners">, "id" | "name" | "is_active">;
export type FacilitatorOption = Pick<Tables<"facilitators">, "id" | "name" | "phone" | "is_active">;
export type FormOption = Pick<Tables<"forms">, "id" | "title">;

/** Everything the visit form needs to render its pickers. */
export type VisitReference = {
  villages: VillageOption[];
  experiences: ExperienceOption[];
  partners: PartnerOption[];
  facilitators: FacilitatorOption[];
  /** Published forms, for choosing a visit's feedback form. */
  forms: FormOption[];
};

export type VisitGuestItem = {
  id: string;
  leadId: string;
  status: string;
  isPrimary: boolean;
  name: string | null;
  phone: string;
  email: string | null;
  optedOut: boolean;
  /** Opaque token for this guest's personal feedback link (/fb/<token>). */
  feedbackToken: string;
  /** The WhatsApp conversation with this guest, if one exists. */
  conversationId: string | null;
  needsHuman: boolean;
  lastMessageAt: string | null;
};

/** An existing lead whose phone number matches what is being typed in the guest form. */
export type LeadMatch = {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  optedOut: boolean;
  /** Already a guest on this visit, so it can't be added again. */
  onVisit: boolean;
  /** How many visits this contact is already a guest on (any visit). */
  visitCount: number;
  /** Stored with a different country code than the one picked in the form. */
  codeMismatch: boolean;
};
