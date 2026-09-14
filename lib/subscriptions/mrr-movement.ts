import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";

export type MrrMovement = {
  month: string;        // 'YYYY-MM' (current IST month)
  newMrr: number;       // MRR added by subscriptions that started this month
  churnedMrr: number;   // MRR lost to subscriptions that churned this month
  netMrr: number;       // newMrr − churnedMrr
  lastMonthNet: number; // prior month's net, for the comparison line
  hasData: boolean;
};

const GRACE_MONTHS = 1; // match the Subscriptions page churn definition

// IST 'YYYY-MM-01' for `offset` months back from today (0 = current month).
function istMonthStart(offset: number): string {
  const ist = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
  const [y, m] = ist.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * Current-month MRR movement (New + / Churned − / Net) for the Dashboard panel.
 *
 * Reads subscription_monthly_metrics over the prior + current IST month and sums the
 * new_mrr / churned_mrr across gateways. It deliberately does NOT expose an absolute
 * MRR figure — that RPC's active-MRR (grace-based) differs from the headline MRR metric,
 * so the panel shows the DELTA only and lets the headline card own the absolute number.
 *
 * The RPC is heavy (~2.3s: a months × subscriptions cross-join) and the flagship
 * dashboard is high-traffic, so this is cached on its OWN 6h TTL — NOT the org write
 * tag, which every webhook/sync busts. MRR movement is a monthly figure, so ≤6h
 * staleness is immaterial, and the dashboard almost always serves it warm.
 */
async function loadMrrMovement(orgId: string): Promise<MrrMovement> {
  const from = istMonthStart(1); // prior month
  const to = istMonthStart(0);   // current month
  const supabase = await createServiceClient();
  const { data, error } = await supabase.rpc("subscription_monthly_metrics", {
    p_org: orgId, p_from: from, p_to: to, p_grace_months: GRACE_MONTHS,
  });

  const empty: MrrMovement = { month: to.slice(0, 7), newMrr: 0, churnedMrr: 0, netMrr: 0, lastMonthNet: 0, hasData: false };
  if (error || !data) return empty;

  const rows = data as { month: string; new_mrr: number | null; churned_mrr: number | null }[];
  const byMonth = new Map<string, { newMrr: number; churnedMrr: number }>();
  for (const r of rows) {
    const key = String(r.month).slice(0, 7);
    const cur = byMonth.get(key) ?? { newMrr: 0, churnedMrr: 0 };
    cur.newMrr += Number(r.new_mrr) || 0;
    cur.churnedMrr += Number(r.churned_mrr) || 0;
    byMonth.set(key, cur);
  }

  const tk = to.slice(0, 7), pk = from.slice(0, 7);
  const t = byMonth.get(tk) ?? { newMrr: 0, churnedMrr: 0 };
  const p = byMonth.get(pk) ?? { newMrr: 0, churnedMrr: 0 };
  return {
    month: tk,
    newMrr: t.newMrr,
    churnedMrr: t.churnedMrr,
    netMrr: t.newMrr - t.churnedMrr,
    lastMonthNet: p.newMrr - p.churnedMrr,
    hasData: rows.length > 0,
  };
}

/** 6h TTL cache, keyed by org — intentionally untagged so org-write invalidation
 *  (which fires on every sync/webhook) does not bust it and thrash the dashboard. */
export function getMrrMovementCached(orgId: string): Promise<MrrMovement> {
  return unstable_cache(() => loadMrrMovement(orgId), ["mrr-movement", orgId], { revalidate: 21600 })();
}

export const SAMPLE_MRR_MOVEMENT: MrrMovement = {
  month: new Date().toISOString().slice(0, 7),
  newMrr: 980000, churnedMrr: 620000, netMrr: 360000, lastMonthNet: -180000, hasData: true,
};
