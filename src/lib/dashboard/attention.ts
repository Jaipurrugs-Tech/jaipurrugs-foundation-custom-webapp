import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/supabase";
import { round2 } from "@/lib/invoices/calc";
import { loadPendingPayouts, loadProformaBalances, loadVillageOptions } from "@/lib/finance/queries";
import { programsLabel } from "@/lib/visits/constants";
import { todayIST } from "@/lib/visits/time";

type Client = SupabaseClient<Database>;

const TOP = 5;
const UPCOMING_DAYS = 7;

export type AttentionInvoice = { id: string; piNumber: string; client: string; balance: number };
export type AttentionPayout = { visitId: string; label: string; villages: string; pending: number };
export type AttentionTrip = {
  id: string;
  date: string;
  type: string;
  status: string;
  contact: string | null;
  headcount: number | null;
};

/** The "Needs attention" panel at the top of the dashboard. */
export type DashboardAttention = {
  unpaidInvoices: { count: number; total: number; top: AttentionInvoice[] };
  pendingPayouts: { count: number; total: number; top: AttentionPayout[] };
  failedMessages: number;
  upcomingTrips: AttentionTrip[];
};

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

async function loadUpcomingTrips(supabase: Client): Promise<AttentionTrip[]> {
  const today = todayIST();
  const { data: visits } = await supabase
    .from("visits")
    .select("id, visit_date, start_time, program_categories, visit_type, status, headcount, poc_name")
    .gte("visit_date", today)
    .lte("visit_date", addDays(today, UPCOMING_DAYS - 1))
    .neq("status", "cancelled")
    .order("visit_date")
    .order("start_time", { nullsFirst: false })
    .limit(50);
  const rows = visits ?? [];
  if (rows.length === 0) return [];

  const { data: guests } = await supabase
    .from("visit_guests")
    .select("visit_id, leads(name)")
    .eq("is_primary", true)
    .in(
      "visit_id",
      rows.map((v) => v.id),
    );
  const primary = new Map<string, string>();
  for (const g of guests ?? []) {
    if (g.leads?.name) primary.set(g.visit_id, g.leads.name);
  }

  return rows.map((v) => ({
    id: v.id,
    date: v.visit_date ?? today,
    type: v.program_categories?.length ? programsLabel(v.program_categories) : v.visit_type,
    status: v.status,
    contact: primary.get(v.id) ?? v.poc_name ?? null,
    headcount: v.headcount,
  }));
}

export async function loadDashboardAttention(supabase: Client): Promise<DashboardAttention> {
  const [proformas, pending, failed, upcomingTrips] = await Promise.all([
    loadProformaBalances(supabase),
    loadVillageOptions(supabase).then((villages) => loadPendingPayouts(supabase, villages)),
    supabase
      .from("scheduled_whatsapp_sends")
      .select("id", { count: "exact", head: true })
      // Same as the Messaging page's "Needs attention": failed, or sent with no confirmation either way.
      .in("status", ["failed", "unknown"]),
    loadUpcomingTrips(supabase),
  ]);

  const owing = proformas.filter((p) => p.balance > 0).sort((a, b) => b.balance - a.balance);
  const payouts = [...pending].sort((a, b) => b.pending - a.pending);

  return {
    unpaidInvoices: {
      count: owing.length,
      total: round2(owing.reduce((sum, p) => sum + p.balance, 0)),
      top: owing.slice(0, TOP).map((p) => ({ id: p.id, piNumber: p.piNumber, client: p.billingName, balance: p.balance })),
    },
    pendingPayouts: {
      count: payouts.length,
      total: round2(payouts.reduce((sum, p) => sum + p.pending, 0)),
      top: payouts.slice(0, TOP).map((p) => ({
        visitId: p.visitId,
        label: p.label,
        villages: p.villageNames.join(", "),
        pending: p.pending,
      })),
    },
    failedMessages: failed.count ?? 0,
    upcomingTrips,
  };
}
