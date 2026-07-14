/**
 * Fetch ALL rows for a query, page by page, bypassing PostgREST's 1000-row cap.
 *
 * A plain `.select()` silently returns at most 1000 rows — for a large org that
 * means metrics computed in JS see only a fraction of the data (and, when ordered
 * ascending by date, the OLDEST fraction). Pass a factory that applies `.range()`
 * and this drains every page.
 *
 *   const rows = await selectAll((from, to) =>
 *     supabase.from("transactions").select("...").eq("org_id", id).order("...").range(from, to));
 *
 * Prefer a Postgres rollup view/RPC for hot paths (see lib/metrics); use this for
 * code that still needs the raw rows (currency breakdowns, daily series).
 */
export async function selectAll<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < pageSize) break;
  }
  return out;
}
