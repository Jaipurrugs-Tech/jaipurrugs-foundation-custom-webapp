import { describe, expect, it } from "vitest";
import { computeNps, formatNps } from "./nps-score";

describe("computeNps", () => {
  it("is % promoters minus % detractors", () => {
    expect(computeNps([10, 9, 8, 7, 6, 0])).toEqual({
      score: 0,
      responses: 6,
      promoters: 2,
      passives: 2,
      detractors: 2,
    });
    expect(computeNps([10, 8]).score).toBe(50);
    expect(computeNps([3, 3, 9]).score).toBe(-33);
  });

  it("has no score without answers and ignores out-of-range values", () => {
    expect(computeNps([]).score).toBeNull();
    expect(computeNps([11, -1, Number.NaN]).responses).toBe(0);
  });
});

describe("formatNps", () => {
  it("shows a sign", () => {
    expect(formatNps(50)).toBe("+50");
    expect(formatNps(0)).toBe("0");
    expect(formatNps(-20)).toBe("−20");
  });
});
