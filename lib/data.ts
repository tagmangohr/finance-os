import { createClient } from "@/lib/supabase/server";
import { baseAmt } from "@/lib/utils";
import { getActiveOrg } from "@/lib/org/active-org";
import { POSTED_TRANSACTION_STATUSES, isTransferSource } from "@/lib/finance/transaction-status";
import { calculateRevenue } from "@/lib/intelligence/revenue";
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

export async function getFinancialSummary(): Promise<DashboardSummary> {
  const orgId = await getOrgId();

  if (!orgId) {
    return {
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
  }

  const supabase = await createClient();

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
}

export async function getRevenueDetails(orgId: string) {
  const supabase = await createClient();

  const today = new Date().toISOString().split("T")[0];
  const from365 = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const [revRows, customersResult, revenueMetrics] = await Promise.all([
    // Paginated — full year of revenue, not just the first 1000 rows.
    selectAll<{ transaction_date: string; amount: number; amount_base: number | null; currency: string; counterparty_name: string | null }>((f, t) =>
      supabase
        .from("transactions")
        .select("transaction_date, amount, amount_base, currency, counterparty_name")
        .eq("org_id", orgId)
        .eq("type", "credit")
        .eq("ledger", "payments")              // revenue firewall — bank inflows are never revenue
        .not("category", "eq", "settlement")   // exclude settlement transfers
        .in("status", POSTED_TRANSACTION_STATUSES)
        .gte("transaction_date", from365)
        .lte("transaction_date", today)        // guard corrupt future dates
        .order("transaction_date", { ascending: true })
        .range(f, t)
    ),
    supabase
      .from("entities")
      .select("*")
      .eq("org_id", orgId)
      .eq("type", "customer")
      .order("total_revenue", { ascending: false })
      .limit(20),
    // Live MRR/ARR/growth computed from transactions — no snapshot dependency
    calculateRevenue(orgId, supabase),
  ]);

  // Aggregate by month for the chart (in base currency).
  const monthMap = new Map<string, number>();
  for (const tx of revRows) {
    const m = tx.transaction_date.split("T")[0].slice(0, 7);
    monthMap.set(m, (monthMap.get(m) ?? 0) + baseAmt(tx));
  }
  const revenueByMonth = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => ({ month, amount }));

  // Per-currency breakdown so the original mix stays visible (e.g. "$Y from USD").
  // `original` is the sum in the source currency; `inr` is the base-currency value.
  const curMap = new Map<string, { original: number; inr: number }>();
  for (const tx of revRows) {
    const cur = (tx as { currency?: string }).currency ?? "INR";
    const e = curMap.get(cur) ?? { original: 0, inr: 0 };
    e.original += Number(tx.amount);
    e.inr += baseAmt(tx);
    curMap.set(cur, e);
  }
  const currencyBreakdown = Array.from(curMap.entries())
    .map(([currency, v]) => ({ currency, original: v.original, inr: v.inr }))
    .sort((a, b) => b.inr - a.inr);

  // Build MRR trend from transaction revenue — no snapshot dependency.
  // MoM change is computed between consecutive months in the dataset.
  const mrrTrend = revenueByMonth.map((entry, i, arr) => {
    const prev = arr[i - 1];
    const momChange =
      prev && prev.amount > 0
        ? ((entry.amount - prev.amount) / prev.amount) * 100
        : 0;
    return { month: entry.month, revenue: entry.amount, momChange };
  });

  return {
    revenueByMonth,
    currencyBreakdown,
    customers:  customersResult.data ?? [],
    mrrTrend,
    mrr:        revenueMetrics.mrr,
    arr:        revenueMetrics.arr,
    momGrowth:  revenueMetrics.mom_growth,
    yoyGrowth:  revenueMetrics.yoy_growth,
  };
}

export async function getCashFlowDetails(orgId: string) {
  const supabase = await createClient();

  const cfToday = new Date().toISOString().split("T")[0];
  const cfFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  // All three run in parallel; the transaction fetch is paginated so a busy 90-day
  // window (>1000 rows) isn't truncated to its oldest slice.
  const [transactions, runwayMetrics, categoryResult] = await Promise.all([
    selectAll<{ transaction_date: string; type: "credit" | "debit"; amount: number; amount_base: number | null; category: string | null; counterparty_name: string | null; source: string | null; ledger: "payments" | "bank"; pnl_treatment: string | null }>((f, t) =>
      supabase
        .from("transactions")
        .select("transaction_date, type, amount, amount_base, category, counterparty_name, source, ledger, pnl_treatment")
        .eq("org_id", orgId)
        .in("status", POSTED_TRANSACTION_STATUSES)
        .gte("transaction_date", cfFrom)
        .lte("transaction_date", cfToday)   // guard corrupt future dates
        .order("transaction_date", { ascending: true })
        .range(f, t)
    ),
    // Live burn rate + cash balance computed from transactions
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

  // Classify a row into inflow / outflow / excluded (null), unifying the PG and
  // bank ledgers under one rule so cash flow never double-counts:
  //   • PG payouts/settlements (transfer source, or credit category 'settlement')
  //     → excluded (money already recorded as the underlying charges).
  //   • Bank ledger → driven by its P&L treatment: income = inflow, expense =
  //     outflow, everything else (PG-settlement inflows, transfers, owner draws,
  //     uncategorized) = excluded. This is the double-count firewall for the bank.
  //   • PG payments → credit = inflow, debit (refunds etc.) = outflow, as before.
  type CfRow = (typeof transactions)[number];
  const classify = (tx: CfRow): "inflow" | "outflow" | null => {
    if (isTransferSource(tx.source ?? undefined)) return null;
    if (tx.ledger === "bank") {
      // Only income/expense rows are real cash flow; excluded/uncategorized never
      // move totals. Direction decides the bucket, so a reversal credit (expense)
      // is a cash inflow and its original spend debit is the outflow.
      if (tx.pnl_treatment !== "income" && tx.pnl_treatment !== "expense") return null;
      return tx.type === "credit" ? "inflow" : "outflow";
    }
    if (tx.type === "credit") return tx.category === "settlement" ? null : "inflow";
    return "outflow";
  };

  // Daily cash flow.
  const txByDate = new Map<string, { inflow: number; outflow: number }>();
  for (const tx of transactions) {
    const bucket = classify(tx);
    if (!bucket) continue;
    const date = tx.transaction_date.split("T")[0];
    const existing = txByDate.get(date) ?? { inflow: 0, outflow: 0 };
    if (bucket === "inflow") existing.inflow += baseAmt(tx);
    else existing.outflow += baseAmt(tx);
    txByDate.set(date, existing);
  }

  // Running balance starts at 0 and accumulates the net daily cash flow.
  // An accurate absolute balance requires a connected bank account; anchoring
  // to the Razorpay-derived cash figure would distort the chart (total
  // all-time settlements ≠ current bank balance).  Starting at 0 shows the
  // relative cash-flow trend honestly.
  let runningBalance = 0;

  const sortedDates = Array.from(txByDate.keys()).sort();
  const cashFlowData = sortedDates.map((date) => {
    const day = txByDate.get(date)!;
    runningBalance = runningBalance + day.inflow - day.outflow;
    return { date, inflow: day.inflow, outflow: day.outflow, balance: runningBalance };
  });

  // Monthly aggregation — same classification rule.
  const monthMap = new Map<string, { inflow: number; outflow: number }>();
  for (const tx of transactions) {
    const bucket = classify(tx);
    if (!bucket) continue;
    const m = tx.transaction_date.split("T")[0].slice(0, 7);
    const existing = monthMap.get(m) ?? { inflow: 0, outflow: 0 };
    if (bucket === "inflow") existing.inflow += baseAmt(tx);
    else existing.outflow += baseAmt(tx);
    monthMap.set(m, existing);
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

  return { cashFlowData, monthlyData, forecasts, burnRate, cashBalance, categoryBreakdown };
}

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
