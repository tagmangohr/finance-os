import { unstable_cache, revalidateTag } from "next/cache";

/**
 * Per-org data cache.
 *
 * The dashboard's heavy read paths (revenue/cashflow/bank aggregates) re-run the
 * same expensive Postgres aggregation on EVERY navigation because the pages are
 * `force-dynamic`. The underlying numbers only change when a sync ingests new
 * transactions (hourly / webhook) or a user re-categorizes a bank row — never
 * second-to-second. So we memoize each aggregate keyed by org, with a short TTL
 * as a self-healing safety net and an explicit tag we bust on writes.
 *
 * All org members see identical org-scoped aggregates, so caching by org (not by
 * user) is correct — and the cached fn must use the SERVICE client, because
 * `unstable_cache` forbids request-scoped `cookies()`/`headers()` access.
 */
export const orgTag = (orgId: string): string => `org-data:${orgId}`;

/** Default TTL for cached org aggregates (seconds). Long, because every write path
 *  (sync/webhook via persistTransactions, category edits) busts the org tag
 *  explicitly — so the TTL is only a self-healing backstop, not the freshness
 *  mechanism. A long TTL keeps navigation instant and cold re-fetches rare. */
export const ORG_CACHE_TTL = 3600;

/**
 * Wrap an org-scoped, service-client data loader in a per-org cache.
 * `keyParts` must uniquely identify the shape of the result (function name +
 * any params like a date range); `orgId` is appended automatically.
 */
export function cachedOrgLoader<A extends unknown[], T>(
  loader: (orgId: string, ...args: A) => Promise<T>,
  keyParts: string[],
  revalidate: number = ORG_CACHE_TTL
): (orgId: string, ...args: A) => Promise<T> {
  return (orgId: string, ...args: A) =>
    unstable_cache(
      () => loader(orgId, ...args),
      [...keyParts, orgId, ...args.map((a) => JSON.stringify(a))],
      { revalidate, tags: [orgTag(orgId)] }
    )();
}

/** Bust every cached aggregate for an org (call after a write: sync, categorize).
 *  `"max"` = stale-while-revalidate: the next visit serves cached data instantly
 *  and refreshes in the background, keeping navigation fast. */
export function invalidateOrg(orgId: string): void {
  revalidateTag(orgTag(orgId), "max");
}
