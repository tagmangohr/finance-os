import {
  IndianRupee, TrendingUp, Activity, Repeat, AlertTriangle, HeartPulse, Gauge, Users,
  Coins, Percent, RefreshCw, UserPlus, XCircle, PiggyBank, Landmark, CalendarClock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ComputedMetric } from "@/lib/metrics/types";
import type { SubscriptionsOverview } from "./reports";
import { formatCurrency } from "@/lib/utils";

// ── Subscriptions metric catalog ────────────────────────────────────────────
// Mirrors the Dashboard metric registry (lib/metrics/registry.ts) but with
// subscription-specific metrics, computed from the SubscriptionsOverview the page
// already builds. Used by the customizable KPI strip on /dashboard/subscriptions.

export type SubMetricGroup = "revenue" | "growth" | "retention" | "base";
export const SUB_METRIC_GROUPS: { key: SubMetricGroup; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "growth", label: "Growth" },
  { key: "retention", label: "Retention & churn" },
  { key: "base", label: "Portfolio" },
];

export type SubMetricDef = {
  key: string; label: string; group: SubMetricGroup; accent: string; icon: LucideIcon;
  description: string;
  compute: (d: SubscriptionsOverview) => ComputedMetric;
};

const cur = (v: number) => formatCurrency(v, "INR", true);
const curFull = (v: number) => formatCurrency(v, "INR");
const num = (v: number) => Math.round(v).toLocaleString("en-IN");
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const ratio = (v: number | null) => (v == null ? "—" : v === Infinity ? "∞" : `${v.toFixed(2)}×`);

/** Complete months = everything except the current (partial) month. */
const complete = (d: SubscriptionsOverview) => (d.monthly.length > 1 ? d.monthly.slice(0, -1) : d.monthly);
const lastComplete = (d: SubscriptionsOverview) => { const c = complete(d); return c[c.length - 1]; };
const ok = (m: Partial<ComputedMetric>): ComputedMetric => ({ available: true, ...m } as ComputedMetric);

export const SUB_METRICS: SubMetricDef[] = [
  // ── Revenue ──────────────────────────────────────────────────────────────
  {
    key: "mrr", label: "MRR", group: "revenue", accent: "#10b981", icon: IndianRupee,
    description: "Monthly recurring revenue run-rate of active subscriptions.",
    compute: (d) => ok({ value: d.now.active.mrr, display: cur(d.now.active.mrr), trend: d.kpis.mrrGrowthPct ?? undefined, trendLabel: "MoM", spark: d.monthly.map((m) => m.mrr), note: "Active run-rate" }),
  },
  {
    key: "arr", label: "ARR", group: "revenue", accent: "#6366f1", icon: TrendingUp,
    description: "Annual recurring revenue = MRR × 12.",
    compute: (d) => ok({ value: d.now.arr, display: cur(d.now.arr), note: "MRR × 12" }),
  },
  {
    key: "net_new_mrr", label: "Net-new MRR", group: "revenue", accent: "#6366f1", icon: Activity,
    description: "Change in MRR vs the last complete month (new − churned).",
    compute: (d) => ok({ value: d.kpis.netNewMrr, display: cur(d.kpis.netNewMrr), trend: d.kpis.mrrGrowthPct ?? undefined, trendLabel: "MoM", spark: d.monthly.map((m) => m.netNewMrr), note: "vs last complete month" }),
  },
  {
    key: "arpu", label: "ARPU", group: "revenue", accent: "#0ea5e9", icon: Users,
    description: "Average revenue per active user (MRR ÷ active).",
    compute: (d) => ok({ value: d.now.arpu, display: curFull(d.now.arpu), note: "MRR ÷ active" }),
  },
  {
    key: "renewals_mtd", label: "Renewals collected", group: "revenue", accent: "#10b981", icon: RefreshCw,
    description: "Recurring revenue actually charged this month.",
    compute: (d) => ok({ value: d.kpis.renewalsThisMonth, display: cur(d.kpis.renewalsThisMonth), spark: d.monthly.map((m) => m.renewalAmount), note: "collected this month" }),
  },
  {
    key: "annual_share", label: "Annual MRR share", group: "revenue", accent: "#6366f1", icon: CalendarClock,
    description: "Share of active MRR that comes from annual (prepaid) plans.",
    compute: (d) => ok({ value: d.kpis.annualSharePct, display: pct(d.kpis.annualSharePct), note: "of MRR is annual" }),
  },

  // ── Growth ─────────────────────────────────────────────────────────────────
  {
    key: "mrr_growth", label: "MRR growth", group: "growth", accent: "#6366f1", icon: TrendingUp,
    description: "Month-over-month MRR growth rate.",
    compute: (d) => ok({ value: d.kpis.mrrGrowthPct, display: pct(d.kpis.mrrGrowthPct), note: "MoM" }),
  },
  {
    key: "quick_ratio", label: "Quick ratio", group: "growth", accent: "#0ea5e9", icon: Gauge,
    description: "Growth efficiency = new MRR ÷ churned MRR (last complete month).",
    compute: (d) => ok({ value: d.kpis.quickRatio === Infinity ? null : d.kpis.quickRatio, display: ratio(d.kpis.quickRatio), note: "new ÷ churned MRR" }),
  },
  {
    key: "new_subs", label: "New subscriptions", group: "growth", accent: "#10b981", icon: UserPlus,
    description: "New subscriptions activated in the last complete month.",
    compute: (d) => { const lc = lastComplete(d); return ok({ value: lc?.newSubs ?? 0, display: num(lc?.newSubs ?? 0), spark: d.monthly.map((m) => m.newSubs), note: "last complete month" }); },
  },
  {
    key: "churned_subs_mo", label: "Churned (month)", group: "growth", accent: "#ef4444", icon: XCircle,
    description: "Subscriptions churned in the last complete month.",
    compute: (d) => { const lc = lastComplete(d); return ok({ value: lc?.churnedSubs ?? 0, display: num(lc?.churnedSubs ?? 0), spark: d.monthly.map((m) => m.churnedSubs), note: "last complete month" }); },
  },

  // ── Retention & churn ───────────────────────────────────────────────────────
  {
    key: "logo_churn", label: "Logo churn", group: "retention", accent: "#ef4444", icon: Activity,
    description: "% of subscribers lost in the last complete month.",
    compute: (d) => ok({ value: d.kpis.logoChurnPct, display: pct(d.kpis.logoChurnPct), note: "last complete month" }),
  },
  {
    key: "rev_churn", label: "Revenue churn", group: "retention", accent: "#ef4444", icon: Percent,
    description: "% of MRR lost to churn in the last complete month.",
    compute: (d) => ok({ value: d.kpis.revChurnPct, display: pct(d.kpis.revChurnPct), note: "last complete month" }),
  },
  {
    key: "nrr", label: "Net revenue retention", group: "retention", accent: "#8b5cf6", icon: HeartPulse,
    description: "Revenue retained from existing subscribers (rev-churn basis until expansion accrues).",
    compute: (d) => ok({ value: d.kpis.nrrPct, display: pct(d.kpis.nrrPct), note: "rev-churn basis" }),
  },
  {
    key: "avg_lifetime", label: "Avg lifetime", group: "retention", accent: "#8b5cf6", icon: CalendarClock,
    description: "Expected subscription lifetime = 1 ÷ monthly churn.",
    compute: (d) => ok({ value: d.kpis.avgLifetimeMonths, display: d.kpis.avgLifetimeMonths == null ? "—" : `${d.kpis.avgLifetimeMonths.toFixed(1)} mo`, note: "1 ÷ churn" }),
  },
  {
    key: "ltv", label: "LTV", group: "retention", accent: "#6366f1", icon: PiggyBank,
    description: "Lifetime value = ARPU × average lifetime.",
    compute: (d) => ok({ value: d.kpis.ltv, display: d.kpis.ltv == null ? "—" : cur(d.kpis.ltv), note: "ARPU × lifetime" }),
  },
  {
    key: "renewal_success", label: "Renewal success", group: "retention", accent: "#10b981", icon: RefreshCw,
    description: "Share of subscription charges this month that succeeded.",
    compute: (d) => ok({ value: d.kpis.renewalSuccessPct, display: pct(d.kpis.renewalSuccessPct), note: "charges this month" }),
  },

  // ── Portfolio ────────────────────────────────────────────────────────────────
  {
    key: "active_subs", label: "Active subscriptions", group: "base", accent: "#10b981", icon: Repeat,
    description: "Subscriptions currently within their paid period.",
    compute: (d) => ok({ value: d.now.active.subs, display: num(d.now.active.subs), spark: d.monthly.map((m) => m.active), note: `${num(d.now.totalCustomers)} incl. past-due` }),
  },
  {
    key: "past_due", label: "Past due (revivable)", group: "base", accent: "#f59e0b", icon: AlertTriangle,
    description: "Lapsed within the last month, not cancelled — revivable.",
    compute: (d) => ok({ value: d.now.pastDue.subs, display: num(d.now.pastDue.subs), note: `${cur(d.now.pastDue.mrr)} recoverable` }),
  },
  {
    key: "recoverable_mrr", label: "Recoverable MRR", group: "base", accent: "#f59e0b", icon: Coins,
    description: "MRR sitting in the past-due (revivable) base.",
    compute: (d) => ok({ value: d.now.pastDue.mrr, display: cur(d.now.pastDue.mrr), note: "in past-due base" }),
  },
  {
    key: "churned_total", label: "Churned (all-time)", group: "base", accent: "#ef4444", icon: XCircle,
    description: "All subscriptions ever churned (cancelled/expired or lapsed >1mo).",
    compute: (d) => ok({ value: d.now.churned.subs, display: num(d.now.churned.subs), note: "all-time" }),
  },
  {
    key: "total_customers", label: "Total customers", group: "base", accent: "#0ea5e9", icon: Users,
    description: "Active plus past-due (revivable) subscribers.",
    compute: (d) => ok({ value: d.now.totalCustomers, display: num(d.now.totalCustomers), note: "active + past-due" }),
  },
  {
    key: "concentration", label: "Top-10 concentration", group: "base", accent: "#8b5cf6", icon: Landmark,
    description: "Share of MRR from the 10 largest subscriptions (concentration risk).",
    compute: (d) => ok({ value: d.kpis.concentrationPct, display: pct(d.kpis.concentrationPct), note: "of MRR" }),
  },
];

export const SUB_METRICS_BY_KEY: Record<string, SubMetricDef> = Object.fromEntries(SUB_METRICS.map((m) => [m.key, m]));
export const SUB_DEFAULT_PINNED = ["mrr", "arr", "net_new_mrr", "active_subs", "past_due", "logo_churn", "nrr", "quick_ratio"];
export const SUB_DEFAULT_VISIBLE_COUNT = 8;
export const SUB_VISIBLE_COUNT_OPTIONS = [4, 6, 8, 12];

export function computeSubscriptionMetrics(d: SubscriptionsOverview): Record<string, ComputedMetric> {
  const out: Record<string, ComputedMetric> = {};
  for (const m of SUB_METRICS) out[m.key] = m.compute(d);
  return out;
}
