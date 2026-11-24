// Supabase (PostgREST) returns at most 1,000 rows per request, whatever .limit()
// asks for, and says nothing when it cuts a result short. Use these helpers
// wherever every row matters: totals, exports, reports.

const PAGE_SIZE = 1000;

/** Hard stop so a runaway query can't loop forever or exhaust memory. */
const MAX_ROWS = 200_000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Fetches every row of a query by paging with .range().
 *
 * `page(from, to)` must build the full query (select, filters, a stable
 * .order(), ...) and end with `.range(from, to)`. Always order by something
 * unique (e.g. add `.order("id")` last) so pages don't overlap or skip rows.
 *
 *   const rows = await fetchAll((from, to) =>
 *     supabase.from("expenses").select("*").order("expense_date").order("id").range(from, to));
 */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
  throw new Error(`Query returned more than ${MAX_ROWS} rows; narrow it down.`);
}

/** Splits ids into chunks small enough for an `.in()` filter in a URL. */
export function chunk<T>(items: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The PostgREST per-request row cap, for "showing the latest N" notices. */
export const ROW_CAP = PAGE_SIZE;
