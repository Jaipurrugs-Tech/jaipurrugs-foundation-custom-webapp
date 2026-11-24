import { describe, expect, it } from "vitest";
import { chunk, fetchAll } from "./fetch-all";

/** A fake table of `total` rows that returns at most 1,000 per request, like PostgREST. */
function fakeTable(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    return { data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null };
  };
  return { page, calls };
}

describe("fetchAll", () => {
  it("returns every row past the 1,000-row cap", async () => {
    const { page, calls } = fakeTable(2500);
    const rows = await fetchAll(page);
    expect(rows).toHaveLength(2500);
    expect(rows[2499]).toEqual({ id: 2499 });
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("makes one request when everything fits", async () => {
    const { page, calls } = fakeTable(12);
    expect(await fetchAll(page)).toHaveLength(12);
    expect(calls).toHaveLength(1);
  });

  it("asks once more after an exactly full page", async () => {
    const { page, calls } = fakeTable(1000);
    expect(await fetchAll(page)).toHaveLength(1000);
    expect(calls).toHaveLength(2);
  });

  it("throws on a database error instead of returning partial data", async () => {
    await expect(fetchAll(async () => ({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
  });
});

describe("chunk", () => {
  it("splits a list into pieces of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});
