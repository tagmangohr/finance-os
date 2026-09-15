import {
  TrendingUp, Coins, Percent, Receipt, Users, CreditCard, RefreshCw, ShieldAlert,
  Wallet, Flame, Gauge, PiggyBank, ShoppingCart, LineChart, CircleDollarSign,
  UserPlus, Repeat, TrendingDown, Landmark, Activity,
} from "lucide-react";
import { formatCurrency, formatRunway } from "@/lib/utils";
import type { ComputedMetric, MetricData, MetricDef, MonthlyPoint } from "./types";

// ── formatting helpers ───────────────────────────────────────────────────────
const cur = (v: number) => formatCurrency(v, "INR", true);
const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const pctAbs = (v: number) => `${v.toFixed(1)}%`;
const num = (v: number) => Math.round(v).toLocaleString("en-IN");

const unavailable = (note: string): ComputedMetric => ({ value: null, display: "—", available: false, note });

// Period tag for range-scoped cards (the selected window, e.g. "This FY").
const rl = (d: MetricData) => d.rangeLabel ?? "This FY";

// ── month helpers ──────────────────────────────────────────────────────────
/** Complete months = everything except the current (partial) month. */
const complete = (m: MonthlyPoint[]) => (m.length > 1 ? m.slice(0, -1) : m);
const current = (m: MonthlyPoint[]) => m[m.length - 1];
const prev = (m: MonthlyPoint[]) => m[m.length - 2];

function runRate(m: MonthlyPoint[]): number {
  const c = complete(m);
  const last3 = c.slice(-3);
  if (last3.length === 0) return 0;
  return last3.reduce((s, x) => s + x.net, 0) / last3.length;
}

// ── the catalog ──────────────────────────────────────────────────────────────
// `period` on each result is the time-window tag shown on the card. Metrics that
// read d.health / d.customers are RANGE-SCOPED (period = the selected range);
// metrics that read d.monthly / d.totals / d.bankCash are fixed run-rate / live /
// comparison windows (period = a static tag). Every card is therefore anchored.
export const METRICS: MetricDef[] = [
  // ─── Revenue & growth ───────────────────────────────────────────────────
  {
    key: "revenue_mtd", label: "Revenue", group: "revenue", format: "currency",
    requires: "payments", accent: "hsl(var(--metric-revenue))", icon: TrendingUp,
    description: "Gross revenue collected over the selected period (before refunds).",
    compute: (d) => ({ value: d.health.grossVolume, display: cur(d.health.grossVolume), spark: d.monthly.slice(-8).map((x) => x.gross), available: true, period: rl(d) }),
  },
  {
    key: "net_revenue_mtd", label: "Net Revenue", group: "revenue", format: "currency",
    requires: "payments", accent: "hsl(var(--metric-margin))", icon: CircleDollarSign,
    description: "Revenue after refunds and chargebacks over the selected period.",
    compute: (d) => { const v = d.health.grossVolume - d.health.refundAmount; return { value: v, display: cur(v), spark: d.monthly.slice(-8).map((x) => x.net), available: true, period: rl(d) }; },
  },
  {
    key: "gross_volume_90d", label: "Gross Volume", group: "revenue", format: "currency",
    requires: "payments", accent: "hsl(var(--metric-cash))", icon: Activity,
    description: "Total processed payment volume over the selected period (before refunds).",
    compute: (d) => ({ value: d.health.grossVolume, display: cur(d.health.grossVolume), available: true, period: rl(d) }),
  },
  {
    key: "mrr_runrate", label: "MRR", group: "revenue", format: "currencyPerMonth",
    requires: "payments", accent: "hsl(var(--metric-revenue))", icon: LineChart,
    description: "Monthly revenue run-rate — average net revenue of the last 3 complete months. Not affected by the period filter (it's an 'as of now' run-rate).",
    compute: (d) => {
      const rr = runRate(d.monthly);
      const c = complete(d.monthly);
      const b = c.slice(-6, -3);
      const prevRR = b.length ? b.reduce((s, x) => s + x.net, 0) / b.length : 0;
      const trend = prevRR > 0 ? ((rr - prevRR) / prevRR) * 100 : null;
      return { value: rr, display: cur(rr), trend, trendLabel: "vs prior 3mo", spark: c.slice(-8).map((x) => x.net), available: true, period: "run-rate" };
    },
  },
  {
    key: "arr", label: "ARR", group: "revenue", format: "currency",
    requires: "payments", accent: "hsl(var(--metric-profit))", icon: Coins,
    description: "Annual run-rate = MRR run-rate × 12. Not affected by the period filter.",
    compute: (d) => { const v = runRate(d.monthly) * 12; return { value: v, display: cur(v), available: true, period: "run-rate" }; },
  },
  {
    key: "mom_growth", label: "MoM Growth", group: "revenue", format: "percent",
    requires: "payments", accent: "hsl(var(--metric-revenue))", icon: TrendingUp,
    description: "Net revenue month-to-date vs the SAME number of days in the prior month — a like-for-like comparison that's honest mid-month.",
    compute: (d) => {
      const c = d.mtd?.current ?? 0, p = d.mtd?.prior ?? 0;
      if (!d.mtd || p <= 0) return unavailable("Need last month's data");
      const v = ((c - p) / p) * 100;
      return { value: v, display: pct(v), trend: v, available: true, period: "vs last mo" };
    },
  },
  {
    key: "yoy_growth", label: "YoY Growth", group: "revenue", format: "percent",
    requires: "payments", accent: "hsl(var(--metric-profit))", icon: TrendingUp,
    description: "Net revenue this month vs the same month a year ago. Not affected by the period filter.",
    compute: (d) => {
      const cM = current(d.monthly), y = d.monthly[0];
      if (!y || y.net <= 0) return unavailable("Need 13 months of data");
      const v = ((cM.net - y.net) / y.net) * 100;
      return { value: v, display: pct(v), trend: v, available: true, period: "vs last year" };
    },
  },
  {
    key: "ytd_revenue", label: "YTD Revenue", group: "revenue", format: "currency",
    requires: "payments", accent: "hsl(var(--metric-revenue))", icon: Receipt,
    description: "Net revenue from Jan 1 of the current year to date. Fixed calendar window (ignores the period filter).",
    compute: (d) => {
      const jan = `${new Date().getUTCFullYear()}-01`;
      const v = d.monthly.filter((m) => m.month >= jan).reduce((s, m) => s + m.net, 0);
      return { value: v, display: cur(v), available: true, period: "YTD" };
    },
  },

  // ─── Payment health (all range-scoped) ──────────────────────────────────
  {
    key: "success_rate", label: "Success Rate", group: "payments", format: "percent",
    requires: "payments", accent: "hsl(var(--metric-profit))", icon: Percent,
    description: "Completed payments as a share of all attempts (completed + failed), over the selected period.",
    compute: (d) => {
      const attempts = d.health.completed + d.health.failed;
      if (attempts === 0) return unavailable("No payment attempts yet");
      const v = (d.health.completed / attempts) * 100;
      return { value: v, display: pctAbs(v), available: true, period: rl(d) };
    },
  },
  {
    key: "failed_count", label: "Failed Payments", group: "payments", format: "number",
    requires: "payments", accent: "hsl(var(--metric-opex))", icon: TrendingDown,
    description: "Number of failed payment attempts over the selected period.",
    compute: (d) => ({ value: d.health.failed, display: num(d.health.failed), available: true, period: rl(d) }),
  },
  {
    key: "refund_rate", label: "Refund Rate", group: "payments", format: "percent",
    requires: "payments", accent: "hsl(var(--metric-opex))", icon: RefreshCw,
    description: "Refunded amount as a share of gross volume, over the selected period.",
    compute: (d) => {
      if (d.health.grossVolume <= 0) return unavailable("No volume yet");
      const v = (d.health.refundAmount / d.health.grossVolume) * 100;
      return { value: v, display: pctAbs(v), available: true, period: rl(d) };
    },
  },
  {
    key: "refund_amount", label: "Refunds", group: "payments", format: "currency",
    requires: "payments", accent: "hsl(var(--metric-opex))", icon: RefreshCw,
    description: "Total refunded to customers over the selected period.",
    compute: (d) => ({ value: d.health.refundAmount, display: cur(d.health.refundAmount), available: true, period: rl(d) }),
  },
  {
    key: "dispute_rate", label: "Dispute Rate", group: "payments", format: "percent",
    requires: "payments", accent: "hsl(var(--destructive))", icon: ShieldAlert,
    description: "Disputes/chargebacks as a share of completed payments, over the selected period.",
    compute: (d) => {
      if (d.health.completed === 0) return unavailable("No payments yet");
      const v = (d.health.disputeCount / d.health.completed) * 100;
      return { value: v, display: pctAbs(v), available: true, period: rl(d) };
    },
  },
  {
    key: "aov", label: "Avg Order Value", group: "payments", format: "currency",
    requires: "payments", accent: "hsl(var(--metric-margin))", icon: ShoppingCart,
    description: "Average value of a completed payment over the selected period.",
    compute: (d) => {
      if (d.health.completed === 0) return unavailable("No payments yet");
      const v = d.health.netCompletedVolume / d.health.completed;
      return { value: v, display: cur(v), available: true, period: rl(d) };
    },
  },
  {
    key: "txn_count_90d", label: "Payments", group: "payments", format: "number",
    requires: "payments", accent: "hsl(var(--metric-cash))", icon: CreditCard,
    description: "Count of successful payments over the selected period.",
    compute: (d) => ({ value: d.health.completed, display: num(d.health.completed), available: true, period: rl(d) }),
  },

  // ─── Customers & retention ──────────────────────────────────────────────
  {
    key: "paying_customers", label: "Paying Customers", group: "customers", format: "number",
    requires: "payments", accent: "hsl(var(--metric-cash))", icon: Users,
    description: "Distinct paying customers over the selected period.",
    compute: (d) => ({ value: d.customers.paying, display: num(d.customers.paying), available: true, period: rl(d) }),
  },
  {
    key: "arpu", label: "ARPU", group: "customers", format: "currency",
    requires: "payments", accent: "hsl(var(--metric-revenue))", icon: CircleDollarSign,
    description: "Average revenue per paying customer over the selected period.",
    compute: (d) => {
      if (d.customers.paying === 0) return unavailable("No customers yet");
      const v = d.customers.netRevenue / d.customers.paying;
      return { value: v, display: cur(v), available: true, period: rl(d) };
    },
  },
  {
    key: "new_customers", label: "New Customers", group: "customers", format: "number",
    requires: "subscriptions", accent: "hsl(var(--metric-profit))", icon: UserPlus,
    description: "First-time customers this month. Needs customer-identity modeling.",
    compute: () => unavailable("Coming with customer modeling"),
  },
  {
    key: "churn_rate", label: "Churn Rate", group: "customers", format: "percent",
    requires: "subscriptions", accent: "hsl(var(--destructive))", icon: TrendingDown,
    description: "Monthly customer/revenue churn. Needs subscription lifecycle data.",
    compute: () => unavailable("Coming with subscriptions"),
  },
  {
    key: "nrr", label: "Net Revenue Retention", group: "customers", format: "percent",
    requires: "subscriptions", accent: "hsl(var(--metric-profit))", icon: Repeat,
    description: "Expansion − churn across existing customers. Needs subscription data.",
    compute: () => unavailable("Coming with subscriptions"),
  },
  {
    key: "ltv", label: "Customer LTV", group: "customers", format: "currency",
    requires: "subscriptions", accent: "hsl(var(--metric-margin))", icon: PiggyBank,
    description: "Lifetime value per customer. Needs churn + margin.",
    compute: () => unavailable("Coming with subscriptions"),
  },

  // ─── Cash, burn & profit ────────────────────────────────────────────────
  {
    key: "cash_balance", label: "Cash Balance", group: "cash", format: "currency",
    requires: "payments", accent: "hsl(var(--metric-cash))", icon: Wallet,
    description: "Cash on hand right now. Uses the linked bank's real balance (checking + savings + treasury − card owed); falls back to an approximate collections − outflows proxy when no bank is connected. Point-in-time — not affected by the period filter.",
    compute: (d) => {
      if (d.bankCash?.hasData) {
        return { value: d.bankCash.cashBase, display: cur(d.bankCash.cashBase), available: true, period: "live", note: "Bank balance" };
      }
      const v = d.totals.lifetimeInflow - d.totals.lifetimeOutflow;
      return { value: v, display: cur(v), available: true, period: "live", note: "Approx · link a bank for exact" };
    },
  },
  {
    key: "net_burn", label: "Net Burn", group: "cash", format: "currencyPerMonth",
    requires: "expenses", accent: "hsl(var(--metric-opex))", icon: Flame,
    description: "Monthly cash outflow minus inflow, averaged over the last 3 complete months. Lights up when expense data is connected.",
    compute: (d) => {
      if (!d.hasExpenses) return unavailable("Connect expenses");
      const c = complete(d.monthly).slice(-3);
      if (!c.length) return unavailable("Need a month of data");
      const burn = c.reduce((s, m) => s + (m.expense - m.net), 0) / c.length;
      return { value: burn, display: cur(Math.abs(burn)), available: true, period: "3-mo avg", note: burn > 0 ? "burning" : "profitable" };
    },
  },
  {
    key: "runway", label: "Runway", group: "cash", format: "duration",
    requires: "expenses", accent: "hsl(var(--metric-runway))", icon: Gauge,
    description: "Days of cash left at the current spend rate. Point-in-time — not affected by the period filter.",
    compute: (d) => {
      if (!d.hasExpenses) return unavailable("Connect expenses");
      const cash = d.bankCash?.hasData ? d.bankCash.cashBase : (d.totals.lifetimeInflow - d.totals.lifetimeOutflow);
      const c = complete(d.monthly).slice(-3);
      const grossBurn = c.reduce((s, m) => s + m.expense, 0) / (c.length || 1);
      if (grossBurn <= 0) return { value: Infinity, display: "∞", available: true, period: "live", note: "no spend" };
      const days = (cash / grossBurn) * 30;
      return { value: days, display: formatRunway(days), available: true, period: "live", note: "at current spend" };
    },
  },
  {
    key: "gross_margin", label: "Gross Margin", group: "cash", format: "percent",
    requires: "expenses", accent: "hsl(var(--metric-profit))", icon: Percent,
    description: "Net revenue minus cost of goods, as a %, over the last 3 complete months. Needs expense/COGS data.",
    compute: (d) => d.hasExpenses ? (() => {
      const rev = complete(d.monthly).slice(-3).reduce((s, m) => s + m.net, 0);
      const exp = complete(d.monthly).slice(-3).reduce((s, m) => s + m.expense, 0);
      if (rev <= 0) return unavailable("No revenue yet");
      const v = ((rev - exp) / rev) * 100;
      return { value: v, display: pctAbs(v), available: true, period: "3-mo avg" };
    })() : unavailable("Connect expenses"),
  },
  {
    key: "net_profit", label: "Net Profit", group: "cash", format: "currency",
    requires: "expenses", accent: "hsl(var(--metric-profit))", icon: Landmark,
    description: "Net revenue minus expenses for the current month to date. Needs expense data.",
    compute: (d) => {
      if (!d.hasExpenses) return unavailable("Connect expenses");
      const cM = current(d.monthly);
      const v = (cM?.net ?? 0) - (cM?.expense ?? 0);
      return { value: v, display: cur(v), available: true, period: "MTD" };
    },
  },
  {
    key: "expense_mtd", label: "Expenses", group: "cash", format: "currency",
    requires: "expenses", accent: "hsl(var(--metric-opex))", icon: Receipt,
    description: "Total operating expenses for the current month to date. Lights up when expenses are connected.",
    compute: (d) => {
      if (!d.hasExpenses) return unavailable("Connect expenses");
      const cM = current(d.monthly);
      return { value: cM?.expense ?? 0, display: cur(cM?.expense ?? 0), available: true, period: "MTD" };
    },
  },
];

export const METRICS_BY_KEY: Record<string, MetricDef> = Object.fromEntries(METRICS.map((m) => [m.key, m]));

/** Default pinned metrics for a new user (ordered by importance). */
export const DEFAULT_PINNED = [
  "revenue_mtd", "mrr_runrate", "arr", "net_revenue_mtd",
  "success_rate", "paying_customers", "aov", "cash_balance",
  "refund_rate", "gross_volume_90d",
];
export const DEFAULT_VISIBLE_COUNT = 6;
export const VISIBLE_COUNT_OPTIONS = [4, 6, 8, 10, 15, 20];
