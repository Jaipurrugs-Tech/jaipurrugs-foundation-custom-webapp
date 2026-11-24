/** Net Promoter Score maths (no server imports, so it can be unit-tested). */

export type NpsResult = {
  /** −100 to +100, rounded to a whole number; null when nobody has answered yet. */
  score: number | null;
  responses: number;
  promoters: number;
  passives: number;
  detractors: number;
};

/**
 * Standard NPS on a 0–10 "how likely are you to recommend" answer:
 * 9–10 promoters, 7–8 passives, 0–6 detractors; score = % promoters − % detractors.
 * Values outside 0–10 are ignored.
 */
export function computeNps(answers: number[]): NpsResult {
  const valid = answers.filter((n) => Number.isFinite(n) && n >= 0 && n <= 10);
  const promoters = valid.filter((n) => n >= 9).length;
  const detractors = valid.filter((n) => n <= 6).length;
  const responses = valid.length;
  return {
    score: responses === 0 ? null : Math.round(((promoters - detractors) / responses) * 100),
    responses,
    promoters,
    passives: responses - promoters - detractors,
    detractors,
  };
}

/** "+50", "0", "−20". */
export function formatNps(score: number): string {
  return score > 0 ? `+${score}` : score < 0 ? `−${Math.abs(score)}` : "0";
}
