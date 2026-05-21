/**
 * Batched deduplication helper.
 *
 * Why batched?
 *   Supabase PostgREST passes `.in()` as a URL query parameter.  For large
 *   arrays the URL can exceed server limits (~8 KB), causing the request to
 *   fail.  Batching into chunks of ≤ 500 keeps each request well within
 *   limits and below PostgREST's default 1 000-row response cap.
 *
 * Why throw instead of swallow?
 *   If the query silently returns null/error we default to an empty set,
 *   which makes every row look "new" → duplicate inserts on every sync.
 *   Throwing surfaces the real problem immediately.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getExistingExternalIds(
  supabase: any,
  orgId: string,
  connectorId: string,
  externalIds: string[]
): Promise<Set<string>> {
  const BATCH_SIZE = 500;
  const existing = new Set<string>();

  for (let i = 0; i < externalIds.length; i += BATCH_SIZE) {
    const batch = externalIds.slice(i, i + BATCH_SIZE);

    const { data, error } = await supabase
      .from("transactions")
      .select("external_id")
      .eq("org_id", orgId)
      .eq("connector_id", connectorId)
      .in("external_id", batch);

    if (error) {
      throw new Error(`Dedup check failed: ${error.message}`);
    }

    for (const row of data ?? []) {
      if (row.external_id) existing.add(row.external_id as string);
    }
  }

  return existing;
}
