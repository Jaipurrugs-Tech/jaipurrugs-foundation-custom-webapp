import { describe, expect, it } from "vitest";
import { formatPiDate, invoiceTotals, lineAmounts, round2 } from "./calc";

describe("round2 (matches Postgres numeric rounding, half away from zero)", () => {
  it("rounds to the paisa without float surprises", () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe("invoice maths", () => {
  it("applies the per-unit discount before GST", () => {
    expect(lineAmounts({ rate: 1500, quantity: 12, discountRate: 150, gstRate: 18 })).toEqual({
      gross: 18000,
      discount: 1800,
      taxable: 16200,
    });
  });

  it("totals GST per rate on the summed taxable value", () => {
    const totals = invoiceTotals([
      { rate: 1500, quantity: 12, discountRate: 150, gstRate: 18 },
      { rate: 500, quantity: 2, discountRate: 0, gstRate: 18 },
      { rate: 333.33, quantity: 3, discountRate: 0, gstRate: 5 },
    ]);
    expect(totals.taxableTotal).toBe(18199.99);
    expect(totals.gstByRate).toEqual([
      { rate: 5, taxable: 999.99, gst: 50 },
      { rate: 18, taxable: 17200, gst: 3096 },
    ]);
    expect(totals.gstTotal).toBe(3146);
    expect(totals.grandTotal).toBe(21345.99);
  });
});

describe("formatPiDate", () => {
  it("prints dates day-first as on the PI", () => {
    expect(formatPiDate("2026-10-28")).toBe("28.10.2026");
  });
});
