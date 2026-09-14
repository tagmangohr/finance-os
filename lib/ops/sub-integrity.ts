import type { SupabaseClient } from "@supabase/supabase-js";

export type SubDoubleCountGroup = {
  orgId: string;
  subscriptionId: string;
  amount: number;
  date: string;
  externalIds: string[];
};

export type SubDoubleCountResult = {
  scanned: number;
  groups: SubDoubleCountGroup[];
};

/**
 * Watchdog for the Cashfree recurring-charge dedup invariant.
 *
 * Every ingestion path — settlement recon, the SUBSCRIPTION_* webhook, and the
 * subscription poller — writes a recurring charge under external_id
 * `cf_pay_<cf_txn_id>` (see the three normalizers in lib/normalizer). Because
 * cf_txn_id is the SAME PG payment id across all three, the same real payment always
 * collapses onto ONE row via the (org_id, external_id) upsert. If that assumption ever
 * breaks — a path lacks cf_txn_id and falls back to a different id (cf_payment_id) —
 * one charge would land as TWO completed rows and revenue would double-count silently.
 *
 * This surfaces exactly that break: any (org, subscription, amount, day) that has
 * >= 2 DISTINCT external_ids among COMPLETED charges. It does NOT flag the healthy
 * failed-retry-then-success pattern (several attempts, different cf_txn_ids, but only
 * the single success is `completed`, so that group has one external_id here).
 *
 * Read-only — never mutates. `sinceDays` omitted = full history; otherwise a trailing
 * window on transaction_date. Scope to one org with `orgId`, else all orgs.
 *
 * Baseline validated 2026-09-11: 0 offending groups across 30,667 completed Cashfree
 * subscription charges (full history, both active orgs). The dedup holds in practice;
 * this is a forward-looking guard so a future regression is caught, not silent.
 */
export async function detectCashfreeSubDoubleCounts(
  supabase: SupabaseClient,
  opts: { orgId?: string; sinceDays?: number } = {}
): Promise<SubDoubleCountResult> {
  const seen = new Map<string, Set<string>>();
  const meta = new Map<string, { orgId: string; subscriptionId: string; amount: number; date: string }>();
  let scanned = 0;

  const PAGE = 1000;
  const sinceDate =
    opts.sinceDays != null
      ? new Date(Date.now() - opts.sinceDays * 86_400_000).toISOString().slice(0, 10)
      : null;

  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("transactions")
      .select("org_id, external_id, subscription_id, amount, transaction_date")
      .eq("source", "cashfree")
      .eq("status", "completed")
      .eq("type", "credit") // recurring charges are credits; also lets an org-leading index serve this
      .not("subscription_id", "is", null)
      // transaction_date is NOT unique — a bare date sort makes OFFSET pagination unstable
      // (ties can shift across page boundaries, skipping rows), which for a dedup watchdog
      // means silently missing one half of a duplicate. The `id` tiebreaker makes the total
      // order deterministic so every row is visited exactly once.
      .order("transaction_date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (opts.orgId) q = q.eq("org_id", opts.orgId);
    if (sinceDate) q = q.gte("transaction_date", sinceDate);

    const { data, error } = await q;
    if (error) throw new Error(`[sub-integrity] ${error.message}`);
    if (!data || data.length === 0) break;

    for (const r of data) {
      scanned++;
      const orgId = r.org_id as string;
      const subscriptionId = r.subscription_id as string;
      const amount = Number(r.amount);
      const date = r.transaction_date as string;
      const key = `${orgId}|${subscriptionId}|${amount}|${date}`;
      let s = seen.get(key);
      if (!s) {
        s = new Set<string>();
        seen.set(key, s);
        meta.set(key, { orgId, subscriptionId, amount, date });
      }
      s.add(r.external_id as string);
    }
    if (data.length < PAGE) break;
  }

  const groups: SubDoubleCountGroup[] = [];
  for (const [key, ids] of seen) {
    if (ids.size > 1) groups.push({ ...meta.get(key)!, externalIds: [...ids] });
  }
  // Most-recent first — that's the operationally urgent end.
  groups.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return { scanned, groups };
}
