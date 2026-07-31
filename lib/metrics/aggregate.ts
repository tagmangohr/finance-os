import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetricData, MonthlyPoint } from "./types";

const MONTHS_BACK = 13;

/** Ordered "YYYY-MM" keys for the last N months, oldest first, ending this month. */
function monthSkeleton(n: number): string[] {
  const now = new Date();
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

/** Zero-filled contiguous month series, so trend/run-rate math never has holes. */
function fillMonths(byKey: Map<string, Partial<MonthlyPoint>>): MonthlyPoint[] {
  return monthSkeleton(MONTHS_BACK).map((month) => {
    const p = byKey.get(month);
    const gross = p?.gross ?? 0;
    const refunds = p?.refunds ?? 0;
    return {
      month,
      gross,
      refunds,
      net: p?.net ?? gross - refunds,
      expense: p?.expense ?? 0,
      txns: p?.txns ?? 0,
      customers: p?.customers ?? 0,
    };
  });
}

/**
 * Aggregated metric inputs for an org. Prefers the Postgres rollup views
 * (migration 028 — pre-summed, scales to any volume). If the views aren't present
 * yet (migration not applied) it transparently falls back to a paginated in-JS
 * aggregation so the numbers are still correct, just slower, until the migration
 * lands. Never throws — a data problem yields zeros, not a broken page.
 */
export async function getMetricData(orgId: string, supabase: SupabaseClient): Promise<MetricData> {
  try {
    const viaViews = await fromViews(orgId, supabase);
    if (viaViews) return viaViews;
  } catch {
    /* fall through to the paginated fallback */
  }
  try {
    return await fromFallback(orgId, supabase);
  } catch {
    return { ...emptyData(), source: "fallback" };
  }
}

function emptyData(): MetricData {
  return {
    monthly: fillMonths(new Map()),
    health: { completed: 0, failed: 0, pending: 0, refunded: 0, grossVolume: 0, netCompletedVolume: 0, refundAmount: 0, disputeCount: 0, disputeAmount: 0 },
    customers: { paying: 0, netRevenue: 0, txns: 0 },
    totals: { lifetimeInflow: 0, lifetimeOutflow: 0 },
    hasExpenses: false,
    source: "views",
  };
}

// ── Primary path: Postgres rollup views ──────────────────────────────────────
async function fromViews(orgId: string, supabase: SupabaseClient): Promise<MetricData | null> {
  // Views live outside the generated schema types — cast like vw_category_breakdown.
  const v = (name: string) => supabase.from(name as never).select("*").eq("org_id" as never, orgId);
  const [monthly, health, customers, totals] = await Promise.all([
    v("vw_metrics_monthly"),
    v("vw_metrics_payment_health").maybeSingle(),
    v("vw_metrics_customers").maybeSingle(),
    v("vw_metrics_totals").maybeSingle(),
  ]);

  // 42P01 = undefined_table → migration not applied yet → signal fallback.
  const missing = [monthly, health, customers, totals].some(
    (r) => r.error && (r.error.code === "42P01" || /does not exist/i.test(r.error.message))
  );
  if (missing) return null;

  const byKey = new Map<string, Partial<MonthlyPoint>>();
  let expenseSeen = 0;
  for (const row of (monthly.data ?? []) as Record<string, unknown>[]) {
    const key = String(row.month).slice(0, 7);
    const gross = Number(row.gross_revenue ?? 0);
    const refunds = Number(row.refunds ?? 0);
    const expense = Number(row.expense_total ?? 0);
    expenseSeen += expense;
    byKey.set(key, { gross, refunds, net: gross - refunds, expense, txns: Number(row.txn_count ?? 0), customers: Number(row.paying_customers ?? 0) });
  }

  const h = (health.data ?? {}) as Record<string, unknown>;
  const c = (customers.data ?? {}) as Record<string, unknown>;
  const t = (totals.data ?? {}) as Record<string, unknown>;

  return {
    monthly: fillMonths(byKey),
    health: {
      completed: Number(h.completed_count ?? 0),
      failed: Number(h.failed_count ?? 0),
      pending: Number(h.pending_count ?? 0),
      refunded: Number(h.refunded_count ?? 0),
      grossVolume: Number(h.gross_volume ?? 0),
      netCompletedVolume: Number(h.net_completed_volume ?? 0),
      refundAmount: Number(h.refund_amount ?? 0),
      disputeCount: Number(h.dispute_count ?? 0),
      disputeAmount: Number(h.dispute_amount ?? 0),
    },
    customers: {
      paying: Number(c.paying_customers ?? 0),
      netRevenue: Number(c.net_revenue ?? 0),
      txns: Number(c.txn_count ?? 0),
    },
    totals: {
      lifetimeInflow: Number(t.lifetime_inflow ?? 0),
      lifetimeOutflow: Number(t.lifetime_outflow ?? 0),
    },
    hasExpenses: expenseSeen > 0,
    source: "views",
  };
}

// ── Fallback path: paginated aggregation in JS (correct, slower) ─────────────
type Row = {
  transaction_date: string; type: "credit" | "debit"; amount: number; amount_base: number | null;
  status: string; category: string | null; source: string | null; counterparty_name: string | null;
  ledger: "payments" | "bank"; pnl_treatment: string | null;
};

const isTransfer = (source: string | null) => !!source && /(settlement|payout)/i.test(source);
const base = (r: Row) => Number(r.amount_base ?? r.amount ?? 0);

async function fromFallback(orgId: string, supabase: SupabaseClient): Promise<MetricData> {
  const today = new Date();
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (MONTHS_BACK - 1), 1))
    .toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  const rows: Row[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("transactions")
      .select("transaction_date, type, amount, amount_base, status, category, source, counterparty_name, ledger, pnl_treatment")
      .eq("org_id", orgId)
      .gte("transaction_date", from)
      .lte("transaction_date", todayStr)   // guard corrupt future dates
      .order("transaction_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  const byKey = new Map<string, Partial<MonthlyPoint>>();
  const custByMonth = new Map<string, Set<string>>();
  const win90 = new Date(today.getTime() - 90 * 86400000).toISOString().slice(0, 10);
  const jan = `${today.getUTCFullYear()}-01`;

  const health = { completed: 0, failed: 0, pending: 0, refunded: 0, grossVolume: 0, netCompletedVolume: 0, refundAmount: 0, disputeCount: 0, disputeAmount: 0 };
  const custSet90 = new Set<string>();
  let custNet90 = 0, custTxns90 = 0;
  const totals = { lifetimeInflow: 0, lifetimeOutflow: 0 };
  let expenseSeen = 0;

  for (const r of rows) {
    const cat = r.category ?? "";
    if (cat === "settlement" || isTransfer(r.source)) continue;
    const isBank = r.ledger === "bank";
    // Bank rows that aren't real income/expense (PG settlements, transfers,
    // owner draws, uncategorized) move no metric.
    if (isBank && r.pnl_treatment !== "expense" && r.pnl_treatment !== "income") continue;
    const posted = r.status === "completed" || r.status === "refunded"; // failed/pending never hit P&L
    const key = r.transaction_date.slice(0, 7);
    const b = base(r);
    const m = byKey.get(key) ?? { gross: 0, refunds: 0, net: 0, expense: 0, txns: 0, customers: 0 };

    if (r.type === "credit") {
      // Revenue firewall: only PG (payments-ledger) credits are revenue. Bank
      // 'income' credits are tracked in the Bank tab, not in PG revenue metrics.
      if (!isBank) {
        if (r.status === "completed" || r.status === "refunded") m.gross! += b;
        if (r.status === "refunded") m.refunds! += b;
        if (r.status === "completed") {
          m.txns! += 1;
          const label = (r.counterparty_name ?? "").toLowerCase();
          if (label) {
            const set = custByMonth.get(key) ?? new Set<string>();
            set.add(label); custByMonth.set(key, set);
          }
          totals.lifetimeInflow += b;
        }
      } else if (r.pnl_treatment === "expense" && posted) {
        // Bank expense reversal/refund (credit) nets OFF the expense.
        m.expense! -= b; totals.lifetimeOutflow -= b;
      }
    } else {
      // Expense side (POSTED only — failed/pending never count). Bank debits count
      // when treatment='expense'; PG debits keep the refund/dispute split.
      if (isBank) { if (posted) { m.expense! += b; totals.lifetimeOutflow += b; expenseSeen += b; } }
      else if (cat === "refund") m.refunds! += b;
      else if (cat !== "dispute" && posted) { m.expense! += b; totals.lifetimeOutflow += b; expenseSeen += b; }
    }
    m.net = m.gross! - m.refunds!;
    byKey.set(key, m);

    // 90-day payment-health window — PG payments only (bank rows already skipped
    // unless income/expense, and neither belongs in PG payment health).
    if (r.transaction_date >= win90 && !isBank) {
      if (r.type === "credit") {
        if (r.status === "completed") { health.completed += 1; health.netCompletedVolume += b; custTxns90 += 1; custNet90 += b; const l = (r.counterparty_name ?? "").toLowerCase(); if (l) custSet90.add(l); }
        else if (r.status === "failed") health.failed += 1;
        else if (r.status === "pending") health.pending += 1;
        else if (r.status === "refunded") { health.refunded += 1; health.refundAmount += b; }
        if (r.status === "completed" || r.status === "refunded") health.grossVolume += b;
      } else if (cat === "refund") health.refundAmount += b;
      if (cat === "dispute") { health.disputeCount += 1; health.disputeAmount += b; }
    }
  }

  // fold distinct-customer counts into the monthly points
  for (const [key, set] of custByMonth) {
    const m = byKey.get(key); if (m) m.customers = set.size;
  }
  void jan;

  return {
    monthly: fillMonths(byKey),
    health,
    customers: { paying: custSet90.size, netRevenue: custNet90, txns: custTxns90 },
    totals,
    hasExpenses: expenseSeen > 0,
    source: "fallback",
  };
}
