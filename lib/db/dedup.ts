import type { createServiceClient } from "@/lib/supabase/server";

/**
 * Global deduplication helper.
 *
 * WHY global (org-level, not connector-level)?
 *   A payment_id like `pay_xxx` is globally unique in Razorpay.  If the
 *   same Razorpay account is connected as two different connectors (e.g.
 *   during a reconnect), each connector would pass the old per-connector
 *   check and re-insert the same transaction.  Checking by (org_id,
 *   external_id) globally prevents any duplicate regardless of which
 *   connector produced it.
 *
 * WHY batched?
 *   Supabase PostgREST passes `.in()` as a URL query string.  For large
 *   arrays the URL can exceed server limits (~8 KB), causing the request
 *   to fail silently.  Batching into ≤ 500 IDs per request keeps each
 *   call well within limits and below PostgREST's 1 000-row response cap.
 *
 * WHY throw instead of defaulting to empty?
 *   If the query fails and we default to an empty set, every row looks
 *   "new" → duplicate inserts on every sync.  Throwing surfaces the real
 *   problem immediately so it can be diagnosed and fixed.
 */

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

export async function getExistingExternalIds(
  supabase: ServiceClient,
  orgId: string,
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
      // No connector_id filter — deduplicate globally within the org
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
