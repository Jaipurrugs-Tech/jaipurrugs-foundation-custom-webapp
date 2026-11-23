import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/supabase";
import { programLabel } from "@/lib/visits/constants";
import type { InvoiceVisitOption, ServiceItem } from "./types";

type Client = SupabaseClient<Database>;

/** Every service with its locations, slabs and how many PI lines use it. */
export async function loadServices(supabase: Client): Promise<ServiceItem[]> {
  const [{ data: services }, { data: villages }, { data: slabs }, { data: usage }] = await Promise.all([
    supabase.from("services").select("*").order("name"),
    supabase.from("service_villages").select("service_id, village_id"),
    supabase.from("service_slabs").select("*").order("min_headcount"),
    supabase.from("proforma_invoice_items").select("service_id").not("service_id", "is", null),
  ]);

  const villageIds = new Map<string, string[]>();
  for (const row of villages ?? []) {
    villageIds.set(row.service_id, [...(villageIds.get(row.service_id) ?? []), row.village_id]);
  }
  const slabsByService = new Map<string, ServiceItem["slabs"]>();
  for (const slab of slabs ?? []) {
    slabsByService.set(slab.service_id, [...(slabsByService.get(slab.service_id) ?? []), slab]);
  }
  const usageCount = new Map<string, number>();
  for (const row of usage ?? []) {
    if (row.service_id) usageCount.set(row.service_id, (usageCount.get(row.service_id) ?? 0) + 1);
  }

  return (services ?? []).map((service) => ({
    ...service,
    villageIds: villageIds.get(service.id) ?? [],
    slabs: slabsByService.get(service.id) ?? [],
    usageCount: usageCount.get(service.id) ?? 0,
  }));
}

const dateLabel = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export function visitOptionLabel(visit: {
  visit_date: string | null;
  program_category: string;
  source: string | null;
  headcount: number | null;
  primaryGuestName?: string | null;
}) {
  return [
    visit.visit_date ? dateLabel.format(new Date(`${visit.visit_date}T00:00:00Z`)) : "No date",
    programLabel(visit.program_category),
    visit.source || visit.primaryGuestName || null,
    visit.headcount ? `${visit.headcount} pax` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

const VISIT_OPTION_LIMIT = 400;

/**
 * Visits offered in the PI editor: the most recent ones that aren't cancelled, plus
 * `includeId` (the visit already linked) whatever its status.
 */
export async function loadInvoiceVisitOptions(supabase: Client, includeId?: string | null): Promise<InvoiceVisitOption[]> {
  const { data: visits } = await supabase
    .from("visits")
    .select("id, visit_date, status, program_category, program_categories, visitor_category, headcount, source")
    .neq("status", "cancelled")
    .order("visit_date", { ascending: false, nullsFirst: false })
    .limit(VISIT_OPTION_LIMIT);
  const rows = visits ?? [];
  if (includeId && !rows.some((v) => v.id === includeId)) {
    const { data: linked } = await supabase
      .from("visits")
      .select("id, visit_date, status, program_category, program_categories, visitor_category, headcount, source")
      .eq("id", includeId)
      .maybeSingle();
    if (linked) rows.unshift(linked);
  }
  if (rows.length === 0) return [];

  const ids = rows.map((v) => v.id);
  const [{ data: villageRows }, { data: guestRows }] = await Promise.all([
    supabase.from("visit_villages").select("visit_id, village_id").in("visit_id", ids),
    supabase.from("visit_guests").select("visit_id, leads(name)").eq("is_primary", true).in("visit_id", ids),
  ]);
  const villages = new Map<string, string[]>();
  for (const row of villageRows ?? []) villages.set(row.visit_id, [...(villages.get(row.visit_id) ?? []), row.village_id]);
  const primary = new Map<string, string | null>();
  for (const row of guestRows ?? []) primary.set(row.visit_id, row.leads?.name ?? null);

  return rows.map((visit) => {
    const primaryGuestName = primary.get(visit.id) ?? null;
    return {
      id: visit.id,
      label: visitOptionLabel({ ...visit, primaryGuestName }),
      visitDate: visit.visit_date,
      status: visit.status,
      programCategories: visit.program_categories?.length ? visit.program_categories : [visit.program_category],
      visitorCategory: visit.visitor_category,
      headcount: visit.headcount,
      source: visit.source,
      villageIds: villages.get(visit.id) ?? [],
      primaryGuestName,
    };
  });
}
