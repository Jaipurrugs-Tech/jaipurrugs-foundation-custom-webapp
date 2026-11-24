import { describe, expect, it } from "vitest";
import { resolveFinancePeriod } from "./period";

describe("resolveFinancePeriod (Indian financial year, April–March)", () => {
  it("defaults to this FY to date", () => {
    expect(resolveFinancePeriod({}, "2026-11-24")).toEqual({
      id: "fy",
      label: "FY 2026-27 to date",
      from: "2026-04-01",
      to: "2026-11-24",
    });
  });

  it("puts January–March in the FY that started the previous April", () => {
    expect(resolveFinancePeriod({}, "2027-02-10").from).toBe("2026-04-01");
    expect(resolveFinancePeriod({ period: "last_fy" }, "2027-02-10")).toMatchObject({
      label: "FY 2025-26",
      from: "2025-04-01",
      to: "2026-03-31",
    });
  });

  it("starts the 3 and 12 month periods on the first of the month", () => {
    expect(resolveFinancePeriod({ period: "3m" }, "2026-11-24").from).toBe("2026-09-01");
    expect(resolveFinancePeriod({ period: "12m" }, "2026-11-24").from).toBe("2025-12-01");
  });

  it("accepts a valid custom range and ignores an inverted one", () => {
    expect(resolveFinancePeriod({ from: "2026-01-01", to: "2026-01-31" }, "2026-11-24").id).toBe("custom");
    expect(resolveFinancePeriod({ from: "2026-02-01", to: "2026-01-01" }, "2026-11-24").id).toBe("fy");
  });
});
