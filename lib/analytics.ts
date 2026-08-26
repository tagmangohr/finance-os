import { createServiceClient } from "@/lib/supabase/server";
import { calculateRunway } from "@/lib/intelligence/runway";
import { sourceLabel } from "@/lib/finance/transaction-status";
import { getPnl, samplePnl, fyStartForDate, type PnlData, type PnlRow } from "@/lib/pnl";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface AnalyticsPoint {
  month: string;            // 'YYYY-MM'
  grossRevenue: number;     // PG + bank-collected customer payments (matches P&L)
  netRevenue: number;       // gross − refunds − chargebacks
  refunds: number;
  chargebacks: number;
  expenses: number;         // total operating expenses (incl. gateway fees)
  netProfit: number;
  netOperatingIncome: number;
  netMargin: number | null; // % of net revenue
  payingCustomers: number;
  arpu: number | null;      // net revenue ÷ paying customers
  txnCount: number;
  refundRate: number | null;    // refunds ÷ gross, %
  chargebackRate: number | null; // chargebacks ÷ gross, %
}

export interface AnalyticsCategory {
  key: string;
  label: string;
  total: number;
  monthly: Record<string, number>;
}

export interface AnalyticsData {
  periodLabel: string;
  from: string;
  to: string;
  preview: boolean;
  months: string[];
  points: AnalyticsPoint[];
  expenseCategories: AnalyticsCategory[];             // sorted desc by total (incl. fees)
  gatewayRevenue: { name: string; amount: number; pct: number }[];
  paymentHealth: { completed: number; failed: number; pending: number; refunded: number };
  headline: {
    grossRevenue: number;
    netRevenue: number;
    netProfit: number;
    netMargin: number | null;
    totalExpenses: number;
    totalRefunds: number;
    totalChargebacks: number;
    payingCustomers: number;   // distinct over the last month in range
    avgMonthlyGrowth: number | null; // avg MoM net-revenue growth %
  };
  runway: { cashBalance: number; burnRate: number; runwayDays: number };
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const rowVal = (row: PnlRow | undefined, m: string) => (row ? row.monthly[m] ?? 0 : 0);
const monthOf = (iso: string) => String(iso).slice(0, 7);

/** Build the analytics points + category series from a computed P&L + supplements. */
function assemble(
  pnl: PnlData,
  from: string,
  to: string,
  preview: boolean,
  supp: {
    customersByMonth: Record<string, number>;
    txnByMonth: Record<string, number>;
    health: { completed: number; failed: number; pending: number; refunded: number };
    gatewayRevenue: { name: string; amount: number; pct: number }[];
    runway: { cashBalance: number; burnRate: number; runwayDays: number };
  }
): AnalyticsData {
  const months = pnl.columns.flatMap((c) => c.monthKeys);
  const byId = Object.fromEntries(pnl.rows.map((r) => [r.id, r] as const));
  const gross = byId["gross_revenue"], refunds = byId["refunds"], chargebacks = byId["chargebacks_lost"];
  const netRev = byId["net_revenue"], opex = byId["total_opex"], noi = byId["net_operating_income"], np = byId["net_profit"];

  const points: AnalyticsPoint[] = months.map((m) => {
    const g = rowVal(gross, m), rf = rowVal(refunds, m), cb = rowVal(chargebacks, m);
    const nr = rowVal(netRev, m), ex = rowVal(opex, m), profit = rowVal(np, m);
    const customers = supp.customersByMonth[m] ?? 0;
    return {
      month: m,
      grossRevenue: g,
      netRevenue: nr,
      refunds: rf,
      chargebacks: cb,
      expenses: ex,
      netProfit: profit,
      netOperatingIncome: rowVal(noi, m),
      netMargin: nr ? (profit / nr) * 100 : null,
      payingCustomers: customers,
      arpu: customers ? nr / customers : null,
      txnCount: supp.txnByMonth[m] ?? 0,
      refundRate: g ? (rf / g) * 100 : null,
      chargebackRate: g ? (cb / g) * 100 : null,
    };
  });

  // Expense categories over time — every P&L row whose id is an expense/fee line.
  const expenseCategories: AnalyticsCategory[] = pnl.rows
    .filter((r) => r.id.startsWith("exp_"))
    .map((r) => ({
      key: r.id.replace(/^exp_/, ""),
      label: r.label,
      monthly: r.monthly,
      total: months.reduce((a, m) => a + (r.monthly[m] ?? 0), 0),
    }))
    .filter((c) => Math.abs(c.total) > 0.5)
    .sort((a, b) => b.total - a.total);

  const sum = (key: keyof AnalyticsPoint) => points.reduce((a, p) => a + (Number(p[key]) || 0), 0);
  const grossTotal = sum("grossRevenue"), netTotal = sum("netRevenue"), profitTotal = sum("netProfit");

  // Average MoM net-revenue growth across the range (skip months with no base).
  const growths: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].netRevenue, cur = points[i].netRevenue;
    if (prev > 0) growths.push(((cur - prev) / prev) * 100);
  }
  const avgMonthlyGrowth = growths.length ? growths.reduce((a, b) => a + b, 0) / growths.length : null;

  return {
    periodLabel: pnl.periodLabel,
    from, to, preview, months, points, expenseCategories,
    gatewayRevenue: supp.gatewayRevenue,
    paymentHealth: supp.health,
    headline: {
      grossRevenue: grossTotal,
      netRevenue: netTotal,
      netProfit: profitTotal,
      netMargin: netTotal ? (profitTotal / netTotal) * 100 : null,
      totalExpenses: sum("expenses"),
      totalRefunds: sum("refunds"),
      totalChargebacks: sum("chargebacks"),
      payingCustomers: points.length ? points[points.length - 1].payingCustomers : 0,
      avgMonthlyGrowth,
    },
    runway: supp.runway,
  };
}

// ─── Main loader ──────────────────────────────────────────────────────────────
export async function getAnalytics(orgId: string, from: string, to: string): Promise<AnalyticsData> {
  const supabase = await createServiceClient();
  const fyStart = fyStartForDate(new Date(to));

  const [pnl, monthlyRes, gwRows, runway, health] = await Promise.all([
    // Financial backbone — already includes bank customer payments, refunds,
    // chargebacks, fees, opex, net operating income, net profit + per-category series.
    getPnl(orgId, { mode: "custom", fyStart, from, to }),
    // Paying customers + txn count per month (SQL-side distinct — no raw scan).
    supabase.rpc("dash_metrics_monthly" as never, { p_org: orgId, p_from: from, p_to: to } as never),
    // Revenue by gateway (fast rollup RPC; graceful per-month fallback pre-migration).
    revenueByGateway(supabase, orgId, from, to),
    calculateRunway(orgId, supabase),
    drainPaymentHealth(supabase, orgId, from, to),
  ]);

  const customersByMonth: Record<string, number> = {};
  const txnByMonth: Record<string, number> = {};
  for (const r of ((monthlyRes as { data: unknown }).data ?? []) as { month: string; paying_customers: number; txn_count: number }[]) {
    customersByMonth[monthOf(r.month)] = Number(r.paying_customers) || 0;
    txnByMonth[monthOf(r.month)] = Number(r.txn_count) || 0;
  }

  // Gateway split (already {name, amount}); bank-collected revenue is the remainder
  // of Gross Revenue, surfaced as a single "Bank / Direct" slice below.
  const built = assemble(pnl, from, to, false, {
    customersByMonth, txnByMonth, health,
    gatewayRevenue: [], // filled below (needs grossTotal)
    runway: { cashBalance: runway.cash_balance, burnRate: runway.burn_rate, runwayDays: runway.runway_days },
  });
  const gwSum = gwRows.reduce((a, g) => a + g.amount, 0);
  const bankRemainder = built.headline.grossRevenue - gwSum;
  const slices = [...gwRows];
  if (bankRemainder > 0.5) slices.push({ name: "Bank / Direct", amount: bankRemainder });
  const sliceTotal = slices.reduce((a, g) => a + g.amount, 0) || 1;
  built.gatewayRevenue = slices
    .map((g) => ({ ...g, pct: (g.amount / sliceTotal) * 100 }))
    .sort((a, b) => b.amount - a.amount);

  return built;
}

/** Sum payment-status counts over the range from the tiny daily rollup (keyset by
 *  day so a multi-year custom range isn't capped at 1000 rows). */
async function drainPaymentHealth(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  orgId: string,
  from: string,
  to: string
): Promise<{ completed: number; failed: number; pending: number; refunded: number }> {
  const acc = { completed: 0, failed: 0, pending: 0, refunded: 0 };
  let cursor = "";
  for (let i = 0; i < 50; i++) {
    let q = supabase
      .from("rollup_metrics_daily")
      .select("day, completed_cnt, failed_cnt, pending_cnt, refunded_cnt")
      .eq("org_id", orgId)
      .gte("day", from)
      .lte("day", to)
      .order("day", { ascending: true })
      .limit(1000);
    if (cursor) q = q.gt("day", cursor);
    const { data } = (await q) as { data: { day: string; completed_cnt: number; failed_cnt: number; pending_cnt: number; refunded_cnt: number }[] | null };
    const rows = data ?? [];
    if (!rows.length) break;
    for (const r of rows) {
      acc.completed += Number(r.completed_cnt) || 0;
      acc.failed += Number(r.failed_cnt) || 0;
      acc.pending += Number(r.pending_cnt) || 0;
      acc.refunded += Number(r.refunded_cnt) || 0;
    }
    if (rows.length < 1000) break;
    cursor = rows[rows.length - 1].day;
  }
  return acc;
}

/** [firstDay, lastDay] per calendar month spanning [from, to], clamped to the range. */
function monthRange(from: string, to: string): [string, string][] {
  const out: [string, string][] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const endKey = to.slice(0, 7);
  for (let i = 0; i < 120; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > endKey) break;
    const first = `${key}-01`;
    const last = `${key}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    out.push([first < from ? from : first, last > to ? to : last]);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * Revenue by gateway over the range. Fast path = the migration-080 rollup RPC
 * (revenue_by_gateway). Until that migration is applied the RPC is missing, so we
 * fall back to per-month pnl_drill_groups calls (each a bounded single-month scan
 * that the drill drawer already uses) and aggregate — bounded to 18 months so a
 * huge custom range can't fan out. Any failure degrades to an empty split (the
 * chart hides) rather than breaking the page.
 */
async function revenueByGateway(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  orgId: string,
  from: string,
  to: string
): Promise<{ name: string; amount: number }[]> {
  const rollup = (await supabase.rpc("revenue_by_gateway" as never, { p_org: orgId, p_from: from, p_to: to } as never)) as { data: { gateway: string; amount: number }[] | null; error: unknown };
  if (!rollup.error && rollup.data) {
    return rollup.data
      .map((g) => ({ name: sourceLabel(g.gateway) || g.gateway, amount: Number(g.amount) || 0 }))
      .filter((g) => g.amount > 0);
  }
  // Fallback: per-month drill grouping (pre-migration).
  const months = monthRange(from, to).slice(0, 18);
  const results = await Promise.all(
    months.map(async ([f, t]) => {
      try {
        const r = (await supabase.rpc("pnl_drill_groups" as never, { p_org: orgId, p_key: "revenue", p_from: f, p_to: t, p_limit: 20 } as never)) as { data: { name: string; amount: number }[] | null; error: unknown };
        return r.error ? [] : r.data ?? [];
      } catch {
        return [] as { name: string; amount: number }[];
      }
    })
  );
  const agg = new Map<string, number>();
  for (const rows of results) for (const g of rows) agg.set(g.name, (agg.get(g.name) ?? 0) + (Number(g.amount) || 0));
  return [...agg.entries()].map(([name, amount]) => ({ name: sourceLabel(name) || name, amount })).filter((g) => g.amount > 0);
}

// ─── Sample (shown before any source is connected) ────────────────────────────
export function sampleAnalytics(from: string, to: string): AnalyticsData {
  const fyStart = fyStartForDate(new Date(to));
  const pnl = samplePnl({ mode: "custom", fyStart, from, to });
  const months = pnl.columns.flatMap((c) => c.monthKeys);
  const customersByMonth: Record<string, number> = {};
  const txnByMonth: Record<string, number> = {};
  months.forEach((m, i) => { customersByMonth[m] = 900 + i * 35; txnByMonth[m] = 3200 + i * 90; });
  const built = assemble(pnl, from, to, true, {
    customersByMonth, txnByMonth,
    health: { completed: 38400, failed: 2100, pending: 320, refunded: 760 },
    gatewayRevenue: [],
    runway: { cashBalance: 21000000, burnRate: 4200000, runwayDays: 150 },
  });
  const g = built.headline.grossRevenue;
  built.gatewayRevenue = [
    { name: "Cashfree", amount: g * 0.46, pct: 46 },
    { name: "Stripe", amount: g * 0.32, pct: 32 },
    { name: "Razorpay", amount: g * 0.12, pct: 12 },
    { name: "Apple Pay", amount: g * 0.06, pct: 6 },
    { name: "Bank / Direct", amount: g * 0.04, pct: 4 },
  ];
  return built;
}
