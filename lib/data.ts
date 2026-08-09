import { createClient, createServiceClient } from "@/lib/supabase/server";
import { cachedOrgLoader } from "@/lib/cache/org-cache";
import { baseAmt } from "@/lib/utils";
import { getActiveOrg } from "@/lib/org/active-org";
import { POSTED_TRANSACTION_STATUSES, isTransferSource } from "@/lib/finance/transaction-status";
import { calculateRunway } from "@/lib/intelligence/runway";
import { getMetricData } from "@/lib/metrics/aggregate";
import { EMPTY_METRIC_DATA, type MetricData } from "@/lib/metrics/types";
import { selectAll } from "@/lib/supabase/paginate";
import type {
  FinancialSnapshot,
  IntelligenceAlert,
  Entity,
  Connector,
} from "@/lib/supabase/types";

export interface DashboardSummary {
  snapshot: FinancialSnapshot | null;
  previousSnapshot: FinancialSnapshot | null;
  alerts: IntelligenceAlert[];
  topDebtors: Entity[];
  revenueByMonth: { month: string; amount: number }[];
  cashFlowData: { date: string; inflow: number; outflow: number; balance: number }[];
  categoryBreakdown: { category: string; amount: number; pct: number }[];
  /** Computed live from transactions — never stale, no snapshot dependency. */
  mrr: number;
  arr: number;
  burnRate: number;
  cashBalance: number;
  runwayDays: number;
  /** MoM revenue growth % */
  mrrGrowth: number;
  /** MoM burn change % */
  burnChange: number;
  /** Pre-aggregated metric inputs (drives the customizable metric strip). */
  metricData: MetricData;
  /** True when the org has any synced transaction data */
  hasData: boolean;
}

export async function getOrgId(): Promise<string | null> {
  // Resolves to the user's ACTIVE org (cookie-selected), not just the oldest.
  const { org } = await getActiveOrg();
  return org?.id ?? null;
}

/**
 * True if the org has connected at least one data source. Used to decide whether
 * to show the sample-data PREVIEW (no connectors yet) vs the user's real data
 * (even if a particular metric/window is currently empty). Cheap head count.
 */
export async function orgHasConnectors(orgId: string): Promise<boolean> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("connectors")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);
  return (count ?? 0) > 0;
}

export async function getOrgWithUser(): Promise<{ orgId: string; orgName: string; userEmail: string } | null> {
  const { org } = await getActiveOrg();
  if (!org) return null;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  return { orgId: org.id, orgName: org.name, userEmail: user.email ?? "" };
}

const EMPTY_SUMMARY: DashboardSummary = {
  snapshot: null,
  previousSnapshot: null,
  alerts: [],
  topDebtors: [],
  revenueByMonth: [],
  cashFlowData: [],
  categoryBreakdown: [],
  mrr: 0,
  arr: 0,
  burnRate: 0,
  cashBalance: 0,
  runwayDays: 0,
  mrrGrowth: 0,
  burnChange: 0,
  metricData: EMPTY_METRIC_DATA,
  hasData: false,
};

export async function getFinancialSummary(): Promise<DashboardSummary> {
  // orgId resolution reads cookies → must happen OUTSIDE the cache boundary.
  const orgId = await getOrgId();
  if (!orgId) return EMPTY_SUMMARY;
  return financialSummaryCached(orgId);
}

// Cached, service-client body (org-scoped aggregate; identical for all members).
const financialSummaryCached = cachedOrgLoader(
  async (orgId: string): Promise<DashboardSummary> => {
  const supabase = await createServiceClient();

  const [
    snapshotResult,
    alertsResult,
    debtorsResult,
    categoryResult,
    metricData,
  ] = await Promise.all([
    supabase
      .from("financial_snapshots")
      .select("*")
      .eq("org_id", orgId)
      .order("snapshot_date", { ascending: false })
      .limit(2),
    supabase
      .from("intelligence_alerts")
      .select("*")
      .eq("org_id", orgId)
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("entities")
      .select("*")
      .eq("org_id", orgId)
      .eq("type", "customer")
      .gt("outstanding_amount", 0)
      .order("outstanding_amount", { ascending: false })
      .limit(5),
    supabase
      .from("vw_category_breakdown" as never)
      .select("*")
      .eq("org_id" as never, orgId)
      .order("total_amount" as never, { ascending: false })
      .limit(8),
    // Server-side aggregation — uncapped, scales past the 1000-row PostgREST limit.
    getMetricData(orgId, supabase),
  ]);

  const snapshots = snapshotResult.data ?? [];
  const snapshot = snapshots[0] ?? null;
  const previousSnapshot = snapshots[1] ?? null;

  // All time-series derived from the pre-aggregated metric data (uncapped, INR).
  const monthly = metricData.monthly;

  // Monthly cash-flow points (one per month): inflow = gross revenue,
  // outflow = expenses + refunds. The dashboard chart groups by month anyway, so
  // month-level points avoid re-fetching 100k+ rows for daily granularity.
  let runningBalance = snapshot?.cash_balance ?? 0;
  const cashFlowData = monthly.map((m) => {
    const inflow = m.gross;
    const outflow = m.expense + m.refunds;
    runningBalance = runningBalance + inflow - outflow;
    return { date: `${m.month}-01`, inflow, outflow, balance: runningBalance };
  });

  const revenueByMonth = monthly.map((m) => ({ month: m.month, amount: m.net }));

  // Run-rate MRR = average net of the last 3 COMPLETE months (drop the current
  // partial month). Phase 2 replaces this with true recurring MRR.
  const completeMonths = monthly.length > 1 ? monthly.slice(0, -1) : monthly;
  const last3 = completeMonths.slice(-3);
  const mrr = last3.length ? last3.reduce((s, m) => s + m.net, 0) / last3.length : 0;
  const arr = mrr * 12;
  const curM = monthly[monthly.length - 1];
  const prevM = monthly[monthly.length - 2];
  const mrrGrowth = prevM && prevM.net > 0 && curM ? ((curM.net - prevM.net) / prevM.net) * 100 : 0;

  const cashBalance = metricData.totals.lifetimeInflow - metricData.totals.lifetimeOutflow;
  const burnRate = metricData.hasExpenses
    ? Math.max(0, last3.reduce((s, m) => s + (m.expense - m.net), 0) / (last3.length || 1))
    : 0;
  const runwayDays = burnRate > 0 ? (cashBalance / burnRate) * 30 : 0;

  // Category breakdown
  type CategoryRow = { category: string; total_amount: number; pct_of_total: number };
  const categoryRaw: CategoryRow[] = (categoryResult.data ?? []) as CategoryRow[];
  const categoryBreakdown = categoryRaw.map((c) => ({
    category: c.category,
    amount: c.total_amount,
    pct: Number(c.pct_of_total),
  }));

  return {
    snapshot,
    previousSnapshot,
    alerts:            alertsResult.data ?? [],
    topDebtors:        debtorsResult.data ?? [],
    revenueByMonth,
    cashFlowData,
    categoryBreakdown,
    mrr,
    arr,
    burnRate,
    cashBalance,
    runwayDays,
    mrrGrowth,
    burnChange: 0,
    metricData,
    hasData: monthly.some((m) => m.gross > 0) || cashBalance > 0,
  };
  },
  ["financial-summary"]
);

export const getRevenueDetails = cachedOrgLoader(async (orgId: string, opts?: { from?: string; to?: string }) => {
  const supabase = await createServiceClient();

  // Range: default = last ~13 months (the historic revenue window); overridable
  // via the date-range filter. Both aggregations run in Postgres (RPC), so ANY
  // window stays fast — no raw-row drain.
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const defFrom = new Date(now.getFullYear(), now.getMonth() - 12, 1).toISOString().slice(0, 10);
  const from = opts?.from || defFrom;
  const to = opts?.to || today;

  const [mRes, cRes, customersResult] = await Promise.all([
    supabase.rpc("metrics_monthly_range" as never, { p_org: orgId, p_from: from, p_to: to } as never),
    supabase.rpc("revenue_by_currency_range" as never, { p_org: orgId, p_from: from, p_to: to } as never),
    supabase
      .from("entities")
      .select("*")
      .eq("org_id", orgId)
      .eq("type", "customer")
      .order("total_revenue", { ascending: false })
      .limit(20),
  ]);

  // Fall back to the fixed 13-month views if the RPCs aren't applied yet (the
  // default-range result is identical; a custom range pre-migration is the only gap).
  let monthlyRows: { month: string; gross_revenue: number }[];
  let currencyRows: { currency: string; original: number; inr: number }[];
  if (!mRes.error && !cRes.error) {
    monthlyRows = (mRes.data ?? []) as unknown as typeof monthlyRows;
    currencyRows = (cRes.data ?? []) as unknown as typeof currencyRows;
  } else {
    const [mv, cv] = await Promise.all([
      supabase.from("vw_metrics_monthly" as never).select("month, gross_revenue").eq("org_id" as never, orgId).order("month" as never, { ascending: true }),
      supabase.from("vw_revenue_by_currency" as never).select("currency, original, inr").eq("org_id" as never, orgId),
    ]);
    monthlyRows = (mv.data ?? []) as unknown as typeof monthlyRows;
    currencyRows = (cv.data ?? []) as unknown as typeof currencyRows;
  }

  const revenueByMonth = monthlyRows.map((r) => ({
    month: String(r.month).slice(0, 7),
    amount: Number(r.gross_revenue ?? 0),
  }));

  // MRR = avg of last 3 months; ARR = ×12; MoM = last vs prev; YoY = last vs
  // earliest (~13 months ago). Derived from the monthly series (ascending).
  const last3 = revenueByMonth.slice(-3);
  const mrr = last3.length ? last3.reduce((s, m) => s + m.amount, 0) / last3.length : 0;
  const arr = mrr * 12;
  const thisMonth = revenueByMonth.at(-1)?.amount ?? 0;
  const lastMonth = revenueByMonth.at(-2)?.amount ?? 0;
  const momGrowth = lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : 0;
  const sameMonthLastYear = revenueByMonth[0]?.amount ?? 0;
  const yoyGrowth = sameMonthLastYear > 0 ? ((thisMonth - sameMonthLastYear) / sameMonthLastYear) * 100 : 0;

  const currencyBreakdown = currencyRows
    .map((c) => ({ currency: c.currency, original: Number(c.original ?? 0), inr: Number(c.inr ?? 0) }))
    .sort((a, b) => b.inr - a.inr);

  const mrrTrend = revenueByMonth.map((entry, i, arr) => {
    const prev = arr[i - 1];
    const momChange = prev && prev.amount > 0 ? ((entry.amount - prev.amount) / prev.amount) * 100 : 0;
    return { month: entry.month, revenue: entry.amount, momChange };
  });

  return {
    revenueByMonth,
    currencyBreakdown,
    customers:  customersResult.data ?? [],
    mrrTrend,
    mrr,
    arr,
    momGrowth,
    yoyGrowth,
    period: { from, to },
  };
}, ["revenue-details"]);

export const getCashFlowDetails = cachedOrgLoader(async (orgId: string, opts?: { from?: string; to?: string }) => {
  const supabase = await createServiceClient();

  // Range: default = last 90 days; overridable via the date-range filter.
  const cfToday = opts?.to || new Date().toISOString().split("T")[0];
  const cfFrom = opts?.from || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const isDefault = !opts?.from && !opts?.to;

  // Daily inflow/outflow aggregated in Postgres (RPC for any range; the fixed
  // 90-day view for the default window). Runway + category run in parallel.
  // NOTE: runway/burn is always a CURRENT 90-day health metric — it does not
  // re-scope to the selected range (a burn rate over an arbitrary window is
  // misleading), so the Runway/Burn cards stay constant as the filter changes.
  const [dailyRes, runwayMetrics, categoryResult] = await Promise.all([
    supabase.rpc("cashflow_daily_range" as never, { p_org: orgId, p_from: cfFrom, p_to: cfToday } as never),
    calculateRunway(orgId, supabase),
    supabase
      .from("vw_category_breakdown" as never)
      .select("*")
      .eq("org_id" as never, orgId)
      .order("total_amount" as never, { ascending: false })
      .limit(8),
  ]);
  const burnRate    = runwayMetrics.burn_rate;
  const cashBalance = runwayMetrics.cash_balance;

  // Daily {date, inflow, outflow} rows from the RPC. Fallbacks when the RPC isn't
  // applied yet: the fixed 90-day view (default range), else a raw-row drain with
  // the app's inflow/outflow classification —
  //   • transfer sources (payouts/settlements) → excluded (already recorded)
  //   • bank ledger → only income/expense move cash (credit=inflow, debit=outflow)
  //   • PG payments → credit (non-settlement)=inflow, debit=outflow
  let dailyRows: { date: string; inflow: number; outflow: number }[];
  const viewRes = dailyRes.error && isDefault
    ? await supabase.from("vw_cashflow_daily" as never).select("date, inflow, outflow").eq("org_id" as never, orgId).order("date" as never, { ascending: true })
    : null;
  if (!dailyRes.error) {
    dailyRows = ((dailyRes.data ?? []) as unknown as { date: string; inflow: number; outflow: number }[])
      .map((r) => ({ date: String(r.date).slice(0, 10), inflow: Number(r.inflow ?? 0), outflow: Number(r.outflow ?? 0) }));
  } else if (viewRes && !viewRes.error) {
    dailyRows = ((viewRes.data ?? []) as unknown as { date: string; inflow: number; outflow: number }[])
      .map((r) => ({ date: String(r.date).slice(0, 10), inflow: Number(r.inflow ?? 0), outflow: Number(r.outflow ?? 0) }));
  } else {
    const transactions = await selectAll<{ transaction_date: string; type: "credit" | "debit"; amount: number; amount_base: number | null; category: string | null; source: string | null; ledger: "payments" | "bank"; pnl_treatment: string | null }>((f, t) =>
      supabase
        .from("transactions")
        .select("transaction_date, type, amount, amount_base, category, source, ledger, pnl_treatment")
        .eq("org_id", orgId)
        .in("status", POSTED_TRANSACTION_STATUSES)
        .gte("transaction_date", cfFrom)
        .lte("transaction_date", cfToday)
        .order("transaction_date", { ascending: true })
        .range(f, t)
    );
    const classify = (tx: (typeof transactions)[number]): "inflow" | "outflow" | null => {
      if (isTransferSource(tx.source ?? undefined)) return null;
      if (tx.ledger === "bank") {
        if (tx.pnl_treatment !== "income" && tx.pnl_treatment !== "expense") return null;
        return tx.type === "credit" ? "inflow" : "outflow";
      }
      if (tx.type === "credit") return tx.category === "settlement" ? null : "inflow";
      return "outflow";
    };
    const m = new Map<string, { inflow: number; outflow: number }>();
    for (const tx of transactions) {
      const b = classify(tx);
      if (!b) continue;
      const d = tx.transaction_date.split("T")[0];
      const e = m.get(d) ?? { inflow: 0, outflow: 0 };
      if (b === "inflow") e.inflow += baseAmt(tx); else e.outflow += baseAmt(tx);
      m.set(d, e);
    }
    dailyRows = Array.from(m.entries()).map(([date, v]) => ({ date, ...v }));
  }

  const sortedDaily = dailyRows.slice().sort((a, b) => a.date.localeCompare(b.date));

  // Running balance starts at 0 (relative trend — an absolute balance needs a
  // connected bank; all-time settlements ≠ current balance).
  let runningBalance = 0;
  const cashFlowData = sortedDaily.map((d) => {
    runningBalance = runningBalance + d.inflow - d.outflow;
    return { date: d.date, inflow: d.inflow, outflow: d.outflow, balance: runningBalance };
  });

  // Monthly aggregation from the same daily rows.
  const monthMap = new Map<string, { inflow: number; outflow: number }>();
  for (const d of sortedDaily) {
    const mo = d.date.slice(0, 7);
    const e = monthMap.get(mo) ?? { inflow: 0, outflow: 0 };
    e.inflow += d.inflow; e.outflow += d.outflow;
    monthMap.set(mo, e);
  }
  const monthlyData = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({ month, ...data, net: data.inflow - data.outflow }));

  // Forecasts: project average monthly net (inflow − outflow) forward.
  // Average over the months we actually have data for — avoids distortion
  // from months with partial data at the edges of the 90-day window.
  // projectedBalance is signed: positive = net inflow, negative = net outflow.
  const avgMonthlyNet = monthlyData.length > 0
    ? monthlyData.reduce((sum, m) => sum + m.net, 0) / monthlyData.length
    : 0;
  const forecasts = [30, 60, 90].map((days) => ({
    days,
    projectedBalance: Math.round(avgMonthlyNet * (days / 30)),
  }));

  type CategoryRow = { category: string; total_amount: number; pct_of_total: number };
  const categoryBreakdown = ((categoryResult.data as CategoryRow[]) ?? []).map((c) => ({
    category: c.category,
    amount:   c.total_amount,
    pct:      Number(c.pct_of_total),
  }));

  return { cashFlowData, monthlyData, forecasts, burnRate, cashBalance, categoryBreakdown, period: { from: cfFrom, to: cfToday } };
}, ["cashflow-details"]);

export async function getCollectionsData(orgId: string) {
  const supabase = await createClient();

  const [overdueResult, debtorsResult, snapshotResult] = await Promise.all([
    supabase
      .from("vw_overdue_invoices" as never)
      .select("*")
      .eq("org_id" as never, orgId)
      .order("days_overdue" as never, { ascending: false }),
    supabase
      .from("entities")
      .select("*")
      .eq("org_id", orgId)
      .eq("type", "customer")
      .gt("outstanding_amount", 0)
      .order("outstanding_amount", { ascending: false }),
    supabase
      .from("financial_snapshots")
      .select("accounts_receivable, collection_rate")
      .eq("org_id", orgId)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .single(),
  ]);

  type OverdueRow = {
    invoice_id: string;
    entity_id: string;
    entity_name: string;
    entity_email: string;
    invoice_number: string;
    amount: number;
    currency: string;
    status: string;
    due_date: string;
    days_overdue: number;
  };

  const overdueInvoices = (overdueResult.data ?? []) as OverdueRow[];

  // Aging buckets
  const aging = {
    current: overdueInvoices.filter((i) => i.days_overdue <= 0).reduce((s, i) => s + i.amount, 0),
    overdue030: overdueInvoices.filter((i) => i.days_overdue > 0 && i.days_overdue <= 30).reduce((s, i) => s + i.amount, 0),
    overdue3160: overdueInvoices.filter((i) => i.days_overdue > 30 && i.days_overdue <= 60).reduce((s, i) => s + i.amount, 0),
    overdue6190: overdueInvoices.filter((i) => i.days_overdue > 60 && i.days_overdue <= 90).reduce((s, i) => s + i.amount, 0),
    overdue90plus: overdueInvoices.filter((i) => i.days_overdue > 90).reduce((s, i) => s + i.amount, 0),
  };
  const totalOutstanding = snapshotResult.data?.accounts_receivable ?? overdueInvoices.reduce((s, i) => s + i.amount, 0);

  return {
    overdueInvoices,
    debtors: debtorsResult.data ?? [],
    aging,
    totalOutstanding,
    collectionRate: snapshotResult.data?.collection_rate ?? 0,
  };
}

export async function getConnectors(orgId: string): Promise<Connector[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("connectors")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: true });
  return data ?? [];
}
