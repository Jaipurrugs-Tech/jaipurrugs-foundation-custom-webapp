import { DashboardView } from "@/components/admin/dashboard/dashboard-view";
import { requireActiveTeamMember } from "@/lib/auth/session";
import { loadDashboardAttention } from "@/lib/dashboard/attention";
import { loadReviewRating } from "@/lib/dashboard/review-rating";
import { createClient } from "@/lib/supabase/server";
import {
  dashboardRpcArgs,
  parseDashboardStats,
  parseRevenueStats,
  resolveDashboardFilters,
  type DashboardSearchParams,
} from "@/lib/visits/dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<DashboardSearchParams> }) {
  await requireActiveTeamMember();
  const filters = resolveDashboardFilters(await searchParams);
  const args = dashboardRpcArgs(filters);
  const supabase = await createClient();

  const [{ data, error }, { data: feedback }, { data: villages }, { data: revenue }, attention, reviewRating] = await Promise.all([
    supabase.rpc("dashboard_stats", args),
    supabase.rpc("dashboard_feedback_stats", args),
    supabase.from("villages").select("id, name").order("name"),
    supabase.rpc("dashboard_revenue_stats", args),
    // The attention panel is a nice-to-have: if it fails, the rest of the dashboard still renders.
    loadDashboardAttention(supabase).catch(() => null),
    loadReviewRating(supabase).catch(() => null),
  ]);
  const stats = error ? null : parseDashboardStats(data, feedback);

  if (!stats) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-danger">The dashboard numbers could not be loaded. Try refreshing the page.</p>
      </div>
    );
  }

  return (
    <DashboardView
      attention={attention}
      filters={filters}
      reviewRating={reviewRating}
      revenue={parseRevenueStats(revenue)}
      stats={stats}
      villages={villages ?? []}
    />
  );
}
