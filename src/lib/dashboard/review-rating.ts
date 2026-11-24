import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/supabase";
import { fetchAll } from "@/lib/supabase/fetch-all";

type Client = SupabaseClient<Database>;

export type ReviewRating = {
  /** Average star rating rescaled to 10 (stars × 2), one decimal; null when no review has stars. */
  outOf10: number | null;
  /** Reviews with a star rating. */
  rated: number;
};

/**
 * The dashboard's "NPS" tile: the average star rating, shown out of 10, of all public reviews
 * (Airbnb + TripAdvisor) on Partners → Reviews. All-time, like that page, so the
 * two always agree; reviews without stars are left out of the average.
 */
export async function loadReviewRating(supabase: Client): Promise<ReviewRating> {
  const rows = await fetchAll((from, to) =>
    supabase.from("reviews").select("id, rating").not("rating", "is", null).order("id").range(from, to),
  );
  const ratings = rows.map((r) => r.rating).filter((n): n is number => typeof n === "number");
  return {
    outOf10: ratings.length === 0 ? null : Math.round(((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 2) * 10) / 10,
    rated: ratings.length,
  };
}
