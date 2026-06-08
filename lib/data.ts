import { createClient } from "@/lib/supabase/server";
import { POSTED_TRANSACTION_STATUSES } from "@/lib/finance/transaction-status";
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
}

export async function getOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("organizations")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  return data?.id ?? null;
}

export async function getOrgWithUser(): Promise<{ orgId: string; orgName: string; userEmail: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("owner_id", user.id)
    .single();

  if (!data) return null;
  return { orgId: data.id, orgName: data.name, userEmail: user.email ?? "" };
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
    };
  }

  const supabase = await createClient();

  const [
    snapshotResult,
    alertsResult,
    debtorsResult,
    revenueResult,
    transactionsResult,
    categoryResult,
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
      .from("transactions")
      .select("transaction_date, amount")
      .eq("org_id", orgId)
      .eq("type", "credit")
      .not("category", "eq", "settlement")   // exclude settlement transfers — already counted as payments
      .in("status", POSTED_TRANSACTION_STATUSES)
      .gte("transaction_date", new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])
      .order("transaction_date", { ascending: true }),
    supabase
      .from("transactions")
      .select("transaction_date, type, amount, category")
      .eq("org_id", orgId)
      .gte("transaction_date", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])
      .in("status", POSTED_TRANSACTION_STATUSES)
      .order("transaction_date", { ascending: true }),
    supabase
      .from("vw_category_breakdown" as never)
      .select("*")
      .eq("org_id" as never, orgId)
      .order("total_amount" as never, { ascending: false })
      .limit(8),
  ]);

  const snapshots = snapshotResult.data ?? [];
  const snapshot = snapshots[0] ?? null;
  const previousSnapshot = snapshots[1] ?? null;

  // Build cash flow data from transactions.
  // Settlements (category = 'settlement') are Razorpay's delayed bank transfer of
  // already-collected payments — they must be excluded from inflows to prevent
  // double-counting every payment once as a payment and again as a settlement.
  const txByDate = new Map<string, { inflow: number; outflow: number }>();
  for (const tx of transactionsResult.data ?? []) {
    if (tx.type === "credit" && (tx as { category?: string }).category === "settlement") continue;
    const date = tx.transaction_date.split("T")[0];
    const existing = txByDate.get(date) ?? { inflow: 0, outflow: 0 };
    if (tx.type === "credit") existing.inflow += tx.amount;
    else existing.outflow += tx.amount;
    txByDate.set(date, existing);
  }

  let runningBalance = snapshot?.cash_balance ?? 0;
  const sortedDates = Array.from(txByDate.keys()).sort();
  const cashFlowData = sortedDates.map((date) => {
    const day = txByDate.get(date)!;
    runningBalance = runningBalance + day.inflow - day.outflow;
    return { date, inflow: day.inflow, outflow: day.outflow, balance: runningBalance };
  });

  // Revenue by month from posted transaction rows.
  const revenueMonthMap = new Map<string, number>();
  for (const tx of revenueResult.data ?? []) {
    const m = tx.transaction_date.split("T")[0].slice(0, 7);
    revenueMonthMap.set(m, (revenueMonthMap.get(m) ?? 0) + tx.amount);
  }
  const revenueByMonth = Array.from(revenueMonthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => ({ month, amount }));

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
    alerts: alertsResult.data ?? [],
    topDebtors: debtorsResult.data ?? [],
    revenueByMonth,
    cashFlowData,
    categoryBreakdown,
  };
}

export async function getRevenueDetails(orgId: string) {
  const supabase = await createClient();

  const [revenueResult, customersResult, snapshotsResult] = await Promise.all([
    supabase
      .from("transactions")
      .select("transaction_date, amount, counterparty_name")
      .eq("org_id", orgId)
      .eq("type", "credit")
      .not("category", "eq", "settlement")   // exclude settlement transfers
      .in("status", POSTED_TRANSACTION_STATUSES)
      .gte("transaction_date", new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])
      .order("transaction_date", { ascending: true }),
    supabase
      .from("entities")
      .select("*")
      .eq("org_id", orgId)
      .eq("type", "customer")
      .order("total_revenue", { ascending: false })
      .limit(20),
    supabase
      .from("financial_snapshots")
      .select("*")
      .eq("org_id", orgId)
      .order("snapshot_date", { ascending: false })
      .limit(13),
  ]);

  // Aggregate by month
  const monthMap = new Map<string, number>();
  for (const tx of revenueResult.data ?? []) {
    const m = tx.transaction_date.split("T")[0].slice(0, 7);
    monthMap.set(m, (monthMap.get(m) ?? 0) + tx.amount);
  }
  const revenueByMonth = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => ({ month, amount }));

  // MRR trend from snapshots
  const snapshots = snapshotsResult.data ?? [];
  const mrrTrend = snapshots.reverse().map((s, i, arr) => {
    const prev = arr[i - 1];
    const momChange = prev ? ((s.mrr - prev.mrr) / (prev.mrr || 1)) * 100 : 0;
    return {
      month: s.snapshot_date.slice(0, 7),
      revenue: s.mrr,
      momChange,
    };
  });

  return {
    revenueByMonth,
    customers: customersResult.data ?? [],
    mrrTrend,
    currentSnapshot: snapshots[snapshots.length - 1] ?? null,
    previousSnapshot: snapshots[snapshots.length - 2] ?? null,
  };
}

export async function getCashFlowDetails(orgId: string) {
  const supabase = await createClient();

  const [txResult, snapshotResult] = await Promise.all([
    supabase
      .from("transactions")
      .select("transaction_date, type, amount, category, counterparty_name")
      .eq("org_id", orgId)
      .in("status", POSTED_TRANSACTION_STATUSES)
      .gte("transaction_date", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0])
      .order("transaction_date", { ascending: true }),
    supabase
      .from("financial_snapshots")
      .select("*")
      .eq("org_id", orgId)
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("vw_category_breakdown" as never)
      .select("*")
      .eq("org_id" as never, orgId)
      .order("total_amount" as never, { ascending: false })
      .limit(8),
  ]);

  const transactions = txResult.data ?? [];
  const snapshot = snapshotResult.data;

  // Daily cash flow.
  // Exclude settlements (category = 'settlement') from inflows — they are Razorpay's
  // delayed bank transfer of already-collected payments, not new money.
  const txByDate = new Map<string, { inflow: number; outflow: number }>();
  for (const tx of transactions) {
    if (tx.type === "credit" && tx.category === "settlement") continue;
    const date = tx.transaction_date.split("T")[0];
    const existing = txByDate.get(date) ?? { inflow: 0, outflow: 0 };
    if (tx.type === "credit") existing.inflow += tx.amount;
    else existing.outflow += tx.amount;
    txByDate.set(date, existing);
  }

  let runningBalance = snapshot?.cash_balance ?? 0;
  const sortedDates = Array.from(txByDate.keys()).sort();
  const cashFlowData = sortedDates.map((date) => {
    const day = txByDate.get(date)!;
    runningBalance = runningBalance + day.inflow - day.outflow;
    return { date, inflow: day.inflow, outflow: day.outflow, balance: runningBalance };
  });

  // Monthly aggregation — same settlement exclusion rule.
  const monthMap = new Map<string, { inflow: number; outflow: number }>();
  for (const tx of transactions) {
    if (tx.type === "credit" && tx.category === "settlement") continue;
    const m = tx.transaction_date.split("T")[0].slice(0, 7);
    const existing = monthMap.get(m) ?? { inflow: 0, outflow: 0 };
    if (tx.type === "credit") existing.inflow += tx.amount;
    else existing.outflow += tx.amount;
    monthMap.set(m, existing);
  }
  const monthlyData = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({ month, ...data, net: data.inflow - data.outflow }));

  // Forecast based on burn rate
  const burnRate = snapshot?.burn_rate ?? 0;
  const cashBalance = snapshot?.cash_balance ?? 0;
  const forecasts = [30, 60, 90].map((days) => ({
    days,
    projectedBalance: Math.max(0, cashBalance - burnRate * (days / 30)),
  }));

  // Category breakdown for cashflow page
  const { data: catData } = await supabase
    .from("vw_category_breakdown" as never)
    .select("*")
    .eq("org_id" as never, orgId)
    .order("total_amount" as never, { ascending: false })
    .limit(8);

  type CategoryRow = { category: string; total_amount: number; pct_of_total: number };
  const categoryBreakdown = ((catData as CategoryRow[]) ?? []).map((c) => ({
    category: c.category,
    amount: c.total_amount,
    pct: Number(c.pct_of_total),
  }));

  return { cashFlowData, monthlyData, forecasts, snapshot, categoryBreakdown };
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
