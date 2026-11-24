import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk, fetchAll } from "@/lib/supabase/fetch-all";
import type { Database } from "@/lib/types/supabase";
import type {
  VisitInvoice,
  VisitListItem,
  VisitPrimaryGuest,
  VisitReference,
  VisitRow,
  VisitSale,
  VisitTaxInvoice,
} from "./types";

type Client = SupabaseClient<Database>;

// PostgREST puts `in (...)` filters in the URL, so cap how many ids go in one.
const MAX_ID_FILTER = 100;

export async function loadVisitReference(supabase: Client): Promise<VisitReference> {
  const [{ data: villages }, { data: experiences }, { data: partners }, { data: facilitators }, { data: forms }] =
    await Promise.all([
    supabase.from("villages").select("id, name, is_active").order("name"),
    supabase.from("experiences").select("id, village_id, name, is_active").order("name"),
    supabase.from("partners").select("id, name, is_active").order("name"),
    supabase.from("facilitators").select("id, name, phone, is_active").order("name"),
    supabase.from("forms").select("id, title").eq("status", "published").order("title"),
  ]);
  return {
    villages: villages ?? [],
    experiences: experiences ?? [],
    partners: partners ?? [],
    facilitators: facilitators ?? [],
    forms: forms ?? [],
  };
}

/** Adds village/experience ids, the guest count and the primary guest to each visit. */
export async function attachVisitRelations(supabase: Client, visits: VisitRow[]): Promise<VisitListItem[]> {
  if (visits.length === 0) return [];
  // Load each relation for these visits only, in chunks of ids (the ids go in the
  // URL) and paging past the 1,000-row response cap, so nothing is cut short.
  const load = async <T,>(page: (ids: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) => {
    const rows: T[] = [];
    for (const ids of chunk(visits.map((v) => v.id), MAX_ID_FILTER)) {
      rows.push(...(await fetchAll((from, to) => page(ids, from, to))));
    }
    return rows;
  };

  const [villageRows, experienceRows, guestRows, saleRows, invoiceRows, taxInvoiceRows, facilitatorRows] =
    await Promise.all([
      load((ids, from, to) =>
        supabase.from("visit_villages").select("visit_id, village_id").in("visit_id", ids).order("visit_id").order("village_id").range(from, to),
      ),
      load((ids, from, to) =>
        supabase
          .from("visit_experiences")
          .select("visit_id, experience_id")
          .in("visit_id", ids)
          .order("visit_id")
          .order("experience_id")
          .range(from, to),
      ),
      load((ids, from, to) =>
        supabase
          .from("visit_guests")
          .select("id, visit_id, is_primary, leads(name, phone, attributes)")
          .in("visit_id", ids)
          .order("id")
          .range(from, to),
      ),
      load((ids, from, to) =>
        supabase
          .from("visit_sales")
          .select("id, visit_id, channel, invoice_id, amount")
          .in("visit_id", ids)
          .order("created_at")
          .order("id")
          .range(from, to),
      ),
      load((ids, from, to) =>
        supabase
          .from("proforma_invoices")
          .select("id, visit_id, pi_number, pi_date, status, taxable_total, grand_total, is_external")
          .in("visit_id", ids)
          .order("pi_date")
          .order("id")
          .range(from, to),
      ),
      load((ids, from, to) =>
        supabase
          .from("tax_invoices")
          .select("id, visit_id, invoice_number, invoice_date, amount, pdf_path")
          .in("visit_id", ids)
          .order("invoice_date", { ascending: false })
          .order("id")
          .range(from, to),
      ),
      load((ids, from, to) =>
        supabase
          .from("visit_facilitators")
          .select("visit_id, facilitator_id, position")
          .in("visit_id", ids)
          .order("position")
          .order("facilitator_id")
          .range(from, to),
      ),
    ]);

  const villageIds = new Map<string, string[]>();
  for (const row of villageRows) {
    villageIds.set(row.visit_id, [...(villageIds.get(row.visit_id) ?? []), row.village_id]);
  }
  const experienceIds = new Map<string, string[]>();
  for (const row of experienceRows) {
    experienceIds.set(row.visit_id, [...(experienceIds.get(row.visit_id) ?? []), row.experience_id]);
  }
  const sales = new Map<string, VisitSale[]>();
  for (const { visit_id, ...sale } of saleRows) {
    sales.set(visit_id, [...(sales.get(visit_id) ?? []), sale]);
  }
  const invoices = new Map<string, VisitInvoice[]>();
  for (const { visit_id, ...invoice } of invoiceRows) {
    if (visit_id) invoices.set(visit_id, [...(invoices.get(visit_id) ?? []), invoice]);
  }
  const taxInvoices = new Map<string, VisitTaxInvoice[]>();
  for (const { visit_id, ...taxInvoice } of taxInvoiceRows) {
    taxInvoices.set(visit_id, [...(taxInvoices.get(visit_id) ?? []), { ...taxInvoice, amount: Number(taxInvoice.amount) }]);
  }
  const facilitatorIds = new Map<string, string[]>();
  for (const row of facilitatorRows) {
    facilitatorIds.set(row.visit_id, [...(facilitatorIds.get(row.visit_id) ?? []), row.facilitator_id]);
  }
  const guestCounts = new Map<string, number>();
  const primaryGuests = new Map<string, VisitPrimaryGuest>();
  for (const row of guestRows) {
    guestCounts.set(row.visit_id, (guestCounts.get(row.visit_id) ?? 0) + 1);
    if (row.is_primary) {
      const email = (row.leads?.attributes as Record<string, unknown> | undefined)?.email;
      primaryGuests.set(row.visit_id, {
        id: row.id,
        name: row.leads?.name ?? null,
        phone: row.leads?.phone ?? "",
        email: typeof email === "string" ? email : null,
      });
    }
  }

  return visits.map((visit) => ({
    ...visit,
    villageIds: villageIds.get(visit.id) ?? [],
    experienceIds: experienceIds.get(visit.id) ?? [],
    guestCount: guestCounts.get(visit.id) ?? 0,
    sales: sales.get(visit.id) ?? [],
    invoices: invoices.get(visit.id) ?? [],
    taxInvoices: taxInvoices.get(visit.id) ?? [],
    facilitatorIds: facilitatorIds.get(visit.id) ?? (visit.facilitator_id ? [visit.facilitator_id] : []),
    primaryGuest: primaryGuests.get(visit.id) ?? null,
  }));
}
