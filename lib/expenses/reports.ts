import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAll } from "@/lib/supabase/paginate";
import { baseAmt, fyStartISO } from "@/lib/utils";
import { calculateRunway } from "@/lib/intelligence/runway";
import { createServiceClient } from "@/lib/supabase/server";
import { cachedOrgLoader } from "@/lib/cache/org-cache";
import { getCategories } from "./categories";
import type { LedgerCategory } from "./types";

export type BankTxn = {
  id: string;
  transaction_date: string;
  transaction_at: string | null;
  type: "credit" | "debit";
  amount: number;
  currency: string;
  amount_base: number | null;
  counterparty_name: string | null;
  description: string | null;
  category: string | null;
  pnl_treatment: "expense" | "income" | "excluded" | "uncategorized" | null;
  category_source: "manual" | "rule" | "ai" | "system" | null;
  category_confidence: number | null;
  account_type: string | null;
  card_last4: string | null;
  card_holder: string | null;
  status: string;
  external_id: string | null;
  metadata: Record<string, unknown> | null;
};

export type BankOverview = {
  transactions: BankTxn[];
  categories: LedgerCategory[];
  monthly: { month: string; expenses: number; otherIncome: number; collections: number; net: number }[];
  totals: {
    expenses: number;
    otherIncome: number;
    excluded: number;
    uncategorizedCount: number;
    collections: number;
    net: number;
    txnCount: number;
  };
  byCategory: { category: string; label: string; treatment: string; amount: number; count: number }[];
  byCard: { last4: string; holder: string | null; amount: number; count: number }[];
  runway: { cashBalance: number; burnRate: number; runwayDays: number };
  period: { from: string; to: string };
};

/**
 * Everything the Bank dashboard renders, scoped to the current financial year.
 * MUST be called with the SERVICE client (bank rows + taxonomy are not client-
 * readable). The reconciled P&L nets categorized bank expenses against PG
 * collections (from the revenue rollup) + non-PG "other income".
 */
export async function getBankOverview(
  orgId: string,
  supabase: SupabaseClient,
  opts?: { from?: string; to?: string }
): Promise<BankOverview> {
  const today = new Date().toISOString().slice(0, 10);
  // Default range = current financial year; overridable via the date-range picker.
  const periodFrom = opts?.from || fyStartISO(new Date());
  const periodTo = opts?.to || today;

  const [categories, transactions, collectionsByMonth, runwayRes] = await Promise.all([
    getCategories(orgId, supabase),
    selectAll<BankTxn>((from, to) =>
      supabase
        .from("transactions")
        .select(
          "id, transaction_date, transaction_at, type, amount, currency, amount_base, counterparty_name, description, category, pnl_treatment, category_source, category_confidence, account_type, card_last4, card_holder, status, external_id, metadata"
        )
        .eq("org_id", orgId)
        .eq("ledger", "bank")
        .gte("transaction_date", periodFrom)
        .lte("transaction_date", periodTo)
        // Sort by the precise timestamp so same-day rows are ordered by time,
        // not arbitrarily. transaction_date is the tiebreaker for null timestamps.
        .order("transaction_at", { ascending: false, nullsFirst: false })
        .order("transaction_date", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
    ),
    // PG collections per month (gross revenue) from the firewalled rollup view.
    supabase
      .from("vw_metrics_monthly" as never)
      .select("month, gross_revenue")
      .eq("org_id" as never, orgId),
    calculateRunway(orgId, supabase),
  ]);

  const labelBySlug = new Map(categories.map((c) => [c.slug, c.label]));
  const collMap = new Map<string, number>();
  for (const r of (collectionsByMonth.data ?? []) as { month: string; gross_revenue: number }[]) {
    const key = String(r.month).slice(0, 7);
    if (key >= periodFrom.slice(0, 7) && key <= periodTo.slice(0, 7)) collMap.set(key, Number(r.gross_revenue ?? 0));
  }

  const monthly = new Map<string, { expenses: number; otherIncome: number }>();
  const byCat = new Map<string, { label: string; treatment: string; amount: number; count: number }>();
  const byCardMap = new Map<string, { holder: string | null; amount: number; count: number }>();
  const totals = { expenses: 0, otherIncome: 0, excluded: 0, uncategorizedCount: 0, collections: 0, net: 0, txnCount: transactions.length };

  for (const t of transactions) {
    // Only POSTED transactions hit the P&L — failed/pending are shown in the table
    // (fetched above) but never counted as expense/income/excluded.
    if (t.status !== "completed" && t.status !== "refunded") continue;
    const amt = baseAmt(t);

    // Per-card spend (net of refunds): any posted row that carries a card.
    if (t.card_last4) {
      const signed = t.type === "debit" ? amt : -amt;
      const c = byCardMap.get(t.card_last4) ?? { holder: t.card_holder, amount: 0, count: 0 };
      c.amount += signed; c.count += 1;
      if (!c.holder && t.card_holder) c.holder = t.card_holder;
      byCardMap.set(t.card_last4, c);
    }
    const key = t.transaction_date.slice(0, 7);
    const m = monthly.get(key) ?? { expenses: 0, otherIncome: 0 };
    const treatment = t.pnl_treatment ?? "uncategorized";

    if (treatment === "expense") {
      // Direction-aware: debit = spend (+), credit = reversal/refund (−).
      const signed = t.type === "debit" ? amt : -amt;
      totals.expenses += signed; m.expenses += signed;
      const slug = t.category ?? "uncategorized";
      const c = byCat.get(slug) ?? { label: labelBySlug.get(slug) ?? slug, treatment, amount: 0, count: 0 };
      c.amount += signed; c.count += 1; byCat.set(slug, c);
    } else if (treatment === "income") {
      // credit = income (+), debit = clawback (−).
      const signed = t.type === "credit" ? amt : -amt;
      totals.otherIncome += signed; m.otherIncome += signed;
    } else if (treatment === "excluded") {
      totals.excluded += amt;
    } else {
      totals.uncategorizedCount += 1;
    }
    monthly.set(key, m);
  }

  for (const v of collMap.values()) totals.collections += v;
  totals.net = totals.collections + totals.otherIncome - totals.expenses;

  const months = Array.from(new Set([...monthly.keys(), ...collMap.keys()])).sort();
  const monthlySeries = months.map((month) => {
    const m = monthly.get(month) ?? { expenses: 0, otherIncome: 0 };
    const collections = collMap.get(month) ?? 0;
    return { month, expenses: m.expenses, otherIncome: m.otherIncome, collections, net: collections + m.otherIncome - m.expenses };
  });

  const byCategory = Array.from(byCat.entries())
    .map(([category, v]) => ({ category, label: v.label, treatment: v.treatment, amount: v.amount, count: v.count }))
    .filter((c) => Math.abs(c.amount) > 0.5) // drop fully-reversed (net ~0) categories
    .sort((a, b) => b.amount - a.amount);

  const byCard = Array.from(byCardMap.entries())
    .map(([last4, v]) => ({ last4, holder: v.holder, amount: v.amount, count: v.count }))
    .sort((a, b) => b.amount - a.amount);

  return {
    transactions,
    categories,
    byCard,
    monthly: monthlySeries,
    totals,
    byCategory,
    runway: { cashBalance: runwayRes.cash_balance, burnRate: runwayRes.burn_rate, runwayDays: runwayRes.runway_days },
    period: { from: periodFrom, to: periodTo },
  };
}

/**
 * Cached, service-client Bank overview keyed by org + date range. Use this from
 * the Bank page (invalidated on category edits + short TTL) instead of calling
 * getBankOverview directly, so repeat navigation is instant.
 */
export const getBankOverviewCached = cachedOrgLoader(
  async (orgId: string, opts?: { from?: string; to?: string }): Promise<BankOverview> => {
    const supabase = await createServiceClient();
    return getBankOverview(orgId, supabase, opts);
  },
  ["bank-overview"]
);
