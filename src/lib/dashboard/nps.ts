import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/supabase";
import { chunk, fetchAll } from "@/lib/supabase/fetch-all";
import { ALL_PROGRAMS, type DashboardFilters } from "@/lib/visits/dashboard";
import { computeNps, type NpsResult } from "./nps-score";

type Client = SupabaseClient<Database>;

/**
 * The dashboard's NPS: every completed answer, in the period, to a 0–10
 * "how likely are you to recommend…" question on any form (a rating or linear
 * scale field running 0 to 10 whose question mentions "recommend").
 *
 * The period is the day the response was completed (IST). Most responses come
 * from the public survey link and aren't tied to a trip, so they always count;
 * a response that IS tied to a trip only counts if that trip matches the
 * program / category / channel / village filters. When category, channel or
 * village is filtered, only trip-linked responses can match, so only those count.
 */
export async function loadDashboardNps(supabase: Client, filters: DashboardFilters): Promise<NpsResult> {
  const { data: fields, error: fieldsError } = await supabase
    .from("form_fields")
    .select("id, config")
    .in("type", ["rating", "linear_scale"])
    .ilike("label", "%recommend%");
  if (fieldsError) throw new Error(fieldsError.message);

  const npsFieldIds = (fields ?? [])
    .filter((f) => {
      const config = (f.config ?? {}) as Record<string, unknown>;
      return Number(config.max) === 10 && Number(config.min ?? 0) === 0;
    })
    .map((f) => f.id);
  if (npsFieldIds.length === 0) return computeNps([]);

  const answers = await fetchAll((from, to) =>
    supabase
      .from("form_answers")
      .select("id, value, form_submissions!inner(status, completed_at, visit_id)")
      .in("field_id", npsFieldIds)
      .eq("form_submissions.status", "completed")
      .gte("form_submissions.completed_at", `${filters.from}T00:00:00+05:30`)
      .lte("form_submissions.completed_at", `${filters.to}T23:59:59.999+05:30`)
      .order("id")
      .range(from, to),
  );

  const narrowsToTrips = Boolean(filters.visitorCategory || filters.bookingChannel || filters.villageId);
  const visitIds = [...new Set(answers.map((a) => a.form_submissions.visit_id).filter((id): id is string => Boolean(id)))];
  const matchingVisits = await loadMatchingVisitIds(supabase, visitIds, filters);

  const scores = answers
    .filter((a) => {
      const visitId = a.form_submissions.visit_id;
      return visitId ? matchingVisits.has(visitId) : !narrowsToTrips;
    })
    .map((a) => Number(a.value));
  return computeNps(scores);
}

async function loadMatchingVisitIds(supabase: Client, visitIds: string[], filters: DashboardFilters): Promise<Set<string>> {
  const matching = new Set<string>();
  for (const ids of chunk(visitIds)) {
    let query = supabase.from("visits").select("id, program_categories, visit_villages(village_id)").in("id", ids);
    if (filters.visitorCategory) query = query.eq("visitor_category", filters.visitorCategory);
    if (filters.bookingChannel) query = query.eq("booking_channel", filters.bookingChannel);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    for (const v of data ?? []) {
      if (filters.program !== ALL_PROGRAMS && !(v.program_categories ?? []).includes(filters.program)) continue;
      if (filters.villageId && !v.visit_villages.some((vv) => vv.village_id === filters.villageId)) continue;
      matching.add(v.id);
    }
  }
  return matching;
}
