import { createServiceClient } from "@/lib/supabase/server";

// ─── Subscriptions dashboard data layer ─────────────────────────────────────────
// Reads the service-role-only subscription tables + rollup views (migration 035) via
// the SERVICE client — the page that calls this is admin-gated, and these tables have
// no client RLS policy (customer PII never reaches the browser API). Aggregation is
// done in Postgres (rollup views + count/head queries), never by summing rows in JS.

const GATEWAYS = ["cashfree", "stripe", "razorpay", "app_store", "payu", "paytm", "easebuzz"] as const;

/** "pending/incomplete" = mandate created but never activated (our 'unknown' bucket). */
function bucket(status: string): "active" | "past_due" | "cancelled" | "expired" | "completed" | "pending" | "other" {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due") return "past_due";
  if (status === "cancelled") return "cancelled";
  if (status === "expired") return "expired";
  if (status === "completed") return "completed";
  if (status === "unknown") return "pending";
  return "other";
}

export type SubscriptionsOverview = {
  totals: { activeSubs: number; mrr: number; arr: number; pending: number; pastDue: number; cancelled: number };
  byGateway: Array<{ gateway: string; active: number; mrr: number; pending: number; cancelled: number }>;
  period: { newThisMonth: number; cancelledThisMonth: number; renewalsThisMonth: number; upcoming30d: number };
  byPlan: Array<{ gateway: string; plan: string; currency: string | null; active: number; mrr: number }>;
  activeList: Array<Record<string, unknown>>;
  upcomingList: Array<Record<string, unknown>>;
  pastDueList: Array<Record<string, unknown>>;
};

const LIST_COLS = "gateway,subscription_id,customer_name,customer_email,customer_phone,plan_name,plan_amount,currency,amount_base,billing_interval,status,native_status,started_at,current_period_end,next_charge_at,cancel_requested_at,ended_at";

export async function getSubscriptionsOverview(orgId: string): Promise<SubscriptionsOverview> {
  const sb = await createServiceClient();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const in30d = new Date(now.getTime() + 30 * 86_400_000).toISOString();
  const nowIso = now.toISOString();

  // ── Rollup summary (active count + MRR per gateway/status) ──
  const { data: summary } = await sb.from("v_subscription_summary").select("*").eq("org_id", orgId);
  const totals = { activeSubs: 0, mrr: 0, arr: 0, pending: 0, pastDue: 0, cancelled: 0 };
  const gwMap = new Map<string, { gateway: string; active: number; mrr: number; pending: number; cancelled: number }>();
  for (const g of GATEWAYS) gwMap.set(g, { gateway: g, active: 0, mrr: 0, pending: 0, cancelled: 0 });
  for (const r of summary ?? []) {
    const b = bucket(r.status as string);
    const g = gwMap.get(r.gateway as string) ?? { gateway: r.gateway as string, active: 0, mrr: 0, pending: 0, cancelled: 0 };
    const n = Number(r.subscriptions ?? 0), mrr = Number(r.mrr_base ?? 0);
    if (b === "active") { totals.activeSubs += n; totals.mrr += mrr; g.active += n; g.mrr += mrr; }
    else if (b === "pending") { totals.pending += n; g.pending += n; }
    else if (b === "past_due") { totals.pastDue += n; }
    else if (b === "cancelled") { totals.cancelled += n; g.cancelled += n; }
    gwMap.set(r.gateway as string, g);
  }
  totals.arr = totals.mrr * 12;

  // ── Period metrics (counts — scale past the row cap safely) ──
  const [newThisMonth, cancelledThisMonth, upcoming30d, renewalsThisMonth] = await Promise.all([
    sb.from("subscriptions").select("*", { count: "exact", head: true }).eq("org_id", orgId).gte("started_at", monthStart).then((r) => r.count ?? 0),
    sb.from("subscriptions").select("*", { count: "exact", head: true }).eq("org_id", orgId).gte("ended_at", monthStart).then((r) => r.count ?? 0),
    sb.from("subscriptions").select("*", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "active").gte("next_charge_at", nowIso).lte("next_charge_at", in30d).then((r) => r.count ?? 0),
    // renewals = subscription charges (tagged transactions) completed this month
    sb.from("transactions").select("*", { count: "exact", head: true }).eq("org_id", orgId).not("subscription_id", "is", null).eq("status", "completed").gte("transaction_date", monthStart.slice(0, 10)).then((r) => r.count ?? 0),
  ]);

  // ── Revenue by plan (active) ──
  const { data: plans } = await sb.from("v_subscription_plan_summary").select("*").eq("org_id", orgId).order("mrr_base", { ascending: false }).limit(50);
  const byPlan = (plans ?? []).map((p) => ({ gateway: p.gateway as string, plan: p.plan as string, currency: (p.currency as string) ?? null, active: Number(p.active_subscriptions ?? 0), mrr: Math.round(Number(p.mrr_base ?? 0)) }));

  // ── Lists (first page; full export via the export API) ──
  const [activeList, upcomingList, pastDueList] = await Promise.all([
    sb.from("subscriptions").select(LIST_COLS).eq("org_id", orgId).eq("status", "active").order("amount_base", { ascending: false, nullsFirst: false }).limit(200).then((r) => r.data ?? []),
    sb.from("subscriptions").select(LIST_COLS).eq("org_id", orgId).eq("status", "active").gte("next_charge_at", nowIso).lte("next_charge_at", in30d).order("next_charge_at", { ascending: true }).limit(200).then((r) => r.data ?? []),
    sb.from("subscriptions").select(LIST_COLS).eq("org_id", orgId).eq("status", "past_due").order("amount_base", { ascending: false, nullsFirst: false }).limit(200).then((r) => r.data ?? []),
  ]);

  return {
    totals: { ...totals, mrr: Math.round(totals.mrr), arr: Math.round(totals.arr) },
    byGateway: [...gwMap.values()].filter((g) => g.active || g.pending || g.cancelled).map((g) => ({ ...g, mrr: Math.round(g.mrr) })),
    period: { newThisMonth, cancelledThisMonth, renewalsThisMonth, upcoming30d },
    byPlan,
    activeList: activeList as Array<Record<string, unknown>>,
    upcomingList: upcomingList as Array<Record<string, unknown>>,
    pastDueList: pastDueList as Array<Record<string, unknown>>,
  };
}
