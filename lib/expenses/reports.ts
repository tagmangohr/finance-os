import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllKeyset } from "@/lib/supabase/paginate";
import { baseAmt, fyStartISO } from "@/lib/utils";
import { calculateRunway } from "@/lib/intelligence/runway";
import { createServiceClient } from "@/lib/supabase/server";
import { cachedOrgLoader } from "@/lib/cache/org-cache";
import { getCategories } from "./categories";
import { getLostDisputesByMonth } from "@/lib/finance/disputes";
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
  // Split feature (087): a child part carries its parent's id here (so the UI can
  // badge it + offer "Unsplit"). Split PARENTS are filtered out of the list.
  split_parent_id: string | null;
};

/**
 * Bank dashboard AGGREGATES — deliberately does NOT include the raw transaction
 * rows. The rows are fetched separately + paginated (getBankTransactions / the
 * /api/bank/transactions endpoint) so the page never computes on or ships tens of
 * thousands of rows: this object stays a few KB no matter how large the ledger, and
 * the transaction table pages server-side. Aggregates are still computed over ALL
 * rows in the range (in SQL-order-independent JS over a keyset drain).
 */
export type BankOverview = {
  categories: LedgerCategory[];
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
  accountTypes: string[]; // distinct account_type values (for the Account filter)
  cards: string[];        // distinct card_last4 values (for the Card filter)
  reviewCount: number;    // rows needing review (same predicate as the row badge)
  runway: { cashBalance: number; burnRate: number; runwayDays: number };
  period: { from: string; to: string };
};

/** Narrow projection used for the aggregate drain (rows are summed, never returned). */
type BankAggRow = Pick<
  BankTxn,
  "id" | "transaction_date" | "type" | "amount" | "currency" | "amount_base" | "category"
  | "pnl_treatment" | "category_source" | "category_confidence" | "account_type" | "card_last4" | "card_holder" | "status"
> & { conn_include_income: boolean; conn_include_expense: boolean; is_split_parent: boolean };

/** A row needs review if uncategorized or a low-confidence AI guess. Shared by the
 *  aggregate reviewCount and the per-row badge so they always agree. */
function bankRowNeedsReview(t: { pnl_treatment: string | null; category_source: string | null; category_confidence: number | null }): boolean {
  return !t.pnl_treatment || t.pnl_treatment === "uncategorized" ||
    (t.category_source === "ai" && (t.category_confidence ?? 1) < 0.6);
}

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

  const [categories, transactions, collectionsByMonth, pgFeesByMonth, lostDisputes, runwayRes] = await Promise.all([
    getCategories(orgId, supabase),
    // KEYSET drain (seek by id), NOT offset. Offset pagination re-scans every
    // preceding row per page, so draining a few thousand WIDE bank rows took 10s+
    // and intermittently tripped the 8s statement timeout → the Bank page 500'd
    // "again and again". Keyset is constant-time per page and stays flat as the
    // ledger grows (verified: 11-15s → ~0.4s). The client re-sorts by transaction_at
    // for display (bank-client.tsx) and every aggregate below is order-independent,
    // so id-ascending drain order is fine.
    selectAllKeyset<BankAggRow>((afterId, limit) => {
      // Aggregation-only columns (no counterparty/description/external_id/
      // transaction_at) — the rows are NOT returned to the client, only summed, so
      // keep them narrow. The paginated table fetches the display columns itself.
      let q = supabase
        .from("transactions")
        .select(
          "id, transaction_date, type, amount, currency, amount_base, category, pnl_treatment, category_source, category_confidence, account_type, card_last4, card_holder, status, conn_include_income, conn_include_expense, is_split_parent"
        )
        .eq("org_id", orgId)
        .eq("ledger", "bank")
        .gte("transaction_date", periodFrom)
        .lte("transaction_date", periodTo)
        .order("id", { ascending: true })
        .limit(limit);
      if (afterId) q = q.gt("id", afterId);
      return q;
    }),
    // PG revenue + refunds per month (fast rollup RPC, same source the P&L page
    // uses). We take gross_revenue AND refunds so "Collections" reflects the PG's
    // NET contribution — matching the dedicated P&L page (which subtracts refunds +
    // gateway fees). Without this the Bank net overstated profit by refunds + fees.
    supabase.rpc("dash_metrics_monthly" as never, { p_org: orgId, p_from: periodFrom, p_to: periodTo } as never),
    // PG processing fees per month (the __pg_fees__ line of the P&L category rollup),
    // subtracted from collections too so both pages tie out.
    supabase.rpc("pnl_monthly" as never, { p_org: orgId, p_from: periodFrom, p_to: periodTo } as never),
    // Lost chargebacks per month — netted out of collections so Bank net ties to
    // the P&L (which now treats them as contra-revenue). Same helper the P&L uses.
    getLostDisputesByMonth(supabase, orgId, periodFrom, periodTo),
    calculateRunway(orgId, supabase),
  ]);

  const labelBySlug = new Map(categories.map((c) => [c.slug, c.label]));
  const inRange = (key: string) => key >= periodFrom.slice(0, 7) && key <= periodTo.slice(0, 7);
  // Collections = PG gross − refunds − gateway fees (net PG contribution to profit),
  // so Collections + Other income − Expenses ties to the P&L's Net Profit.
  const collMap = new Map<string, number>();
  for (const r of (collectionsByMonth.data ?? []) as { month: string; gross_revenue: number; refunds: number }[]) {
    const key = String(r.month).slice(0, 7);
    if (inRange(key)) collMap.set(key, (Number(r.gross_revenue ?? 0) - Number(r.refunds ?? 0)));
  }
  for (const c of (pgFeesByMonth.data ?? []) as { month: string; category: string; amount: number }[]) {
    if (c.category !== "__pg_fees__") continue;
    const key = String(c.month).slice(0, 7);
    if (inRange(key)) collMap.set(key, (collMap.get(key) ?? 0) - Number(c.amount ?? 0));
  }
  // Lost chargebacks are contra-revenue (money the customer took back) — subtract
  // them from collections too, matching the P&L's Net Revenue treatment.
  for (const [key, amt] of Object.entries(lostDisputes)) {
    if (inRange(key)) collMap.set(key, (collMap.get(key) ?? 0) - Number(amt ?? 0));
  }

  const byCat = new Map<string, { label: string; treatment: string; amount: number; count: number }>();
  const accountTypeSet = new Set<string>();
  const cardSet = new Set<string>();
  let reviewCount = 0;
  const totals = { expenses: 0, otherIncome: 0, excluded: 0, uncategorizedCount: 0, collections: 0, net: 0, txnCount: transactions.filter((t) => !t.is_split_parent).length };

  for (const t of transactions) {
    // Split PARENTS are containers, not real rows — their child parts carry the
    // real amounts/categories. Skip them entirely (totals, counts, review).
    if (t.is_split_parent) continue;
    // Distinct filter options + review backlog are computed over ALL rows (any
    // status), matching the table filters + the "Needs review" badge/metric.
    if (t.account_type) accountTypeSet.add(t.account_type);
    if (t.card_last4) cardSet.add(t.card_last4);
    if (bankRowNeedsReview(t)) reviewCount += 1;

    // Only POSTED transactions hit the P&L — failed/pending are shown in the table
    // but never counted as expense/income/excluded.
    if (t.status !== "completed" && t.status !== "refunded") continue;
    const amt = baseAmt(t);
    const treatment = t.pnl_treatment ?? "uncategorized";

    if (treatment === "expense") {
      // Respect the connector expense toggle (084/085): a connector with
      // include_expense OFF drops its bank expenses from the Bank totals too.
      if (!t.conn_include_expense) continue;
      // Direction-aware: debit = spend (+), credit = reversal/refund (−).
      const signed = t.type === "debit" ? amt : -amt;
      totals.expenses += signed;
      const slug = t.category ?? "uncategorized";
      const c = byCat.get(slug) ?? { label: labelBySlug.get(slug) ?? slug, treatment, amount: 0, count: 0 };
      c.amount += signed; c.count += 1; byCat.set(slug, c);
    } else if (treatment === "income") {
      if (!t.conn_include_income) continue; // connector income toggle
      // credit = income (+), debit = clawback (−).
      const signed = t.type === "credit" ? amt : -amt;
      totals.otherIncome += signed;
    } else if (treatment === "excluded") {
      totals.excluded += amt;
    } else {
      totals.uncategorizedCount += 1;
    }
  }

  for (const v of collMap.values()) totals.collections += v;
  totals.net = totals.collections + totals.otherIncome - totals.expenses;

  const byCategory = Array.from(byCat.entries())
    .map(([category, v]) => ({ category, label: v.label, treatment: v.treatment, amount: v.amount, count: v.count }))
    .filter((c) => Math.abs(c.amount) > 0.5) // drop fully-reversed (net ~0) categories
    .sort((a, b) => b.amount - a.amount);

  return {
    categories,
    totals,
    byCategory,
    accountTypes: Array.from(accountTypeSet).sort(),
    cards: Array.from(cardSet).sort(),
    reviewCount,
    runway: { cashBalance: runwayRes.cash_balance, burnRate: runwayRes.burn_rate, runwayDays: runwayRes.runway_days },
    period: { from: periodFrom, to: periodTo },
  };
}

// ─── Paginated transaction table (server-side) ────────────────────────────────

export type BankTxnFilters = {
  from?: string;
  to?: string;
  search?: string;
  status?: string;                    // completed | pending | failed | refunded
  account?: string;                   // account_type
  card?: string;                      // card_last4
  category?: string;                  // exact category slug (category-drill drawer)
  view?: "all" | "expense" | "income" | "excluded" | "review";
  page?: number;                      // 0-based
  pageSize?: number;
};

export type BankTxnPage = { rows: BankTxn[]; total: number; page: number; pageSize: number };

/**
 * One page of bank transactions for the table — filtered + searched + paginated in
 * Postgres so the client never loads the whole ledger. Newest first. MUST use the
 * service client (bank rows aren't client-readable). Scales: each page is a bounded
 * LIMIT over the partial bank index, independent of ledger size.
 */
export async function getBankTransactions(
  orgId: string,
  supabase: SupabaseClient,
  f: BankTxnFilters
): Promise<BankTxnPage> {
  const today = new Date().toISOString().slice(0, 10);
  const from = f.from || fyStartISO(new Date());
  const to = f.to || today;
  const page = Math.max(0, f.page ?? 0);
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 50));

  const cols =
    "id, transaction_date, transaction_at, type, amount, currency, amount_base, counterparty_name, description, category, pnl_treatment, category_source, category_confidence, account_type, card_last4, card_holder, status, external_id, split_parent_id";

  // Apply the identical filter set to a query builder. Typed loosely because the
  // count query and the rows query have different builder result types but share
  // exactly these predicate calls.
  type FilterBuilder = {
    eq: (c: string, v: string) => FilterBuilder;
    gte: (c: string, v: string) => FilterBuilder;
    lte: (c: string, v: string) => FilterBuilder;
    ilike: (c: string, v: string) => FilterBuilder;
    or: (v: string) => FilterBuilder;
  };
  const applyFilters = (q: FilterBuilder): FilterBuilder => {
    let out = q.eq("org_id", orgId).eq("ledger", "bank").gte("transaction_date", from).lte("transaction_date", to);
    // Hide split PARENTS — their child parts are shown as rows instead.
    out = out.eq("is_split_parent", "false");
    if (f.status && f.status !== "all") out = out.eq("status", f.status);
    if (f.account && f.account !== "all") out = out.eq("account_type", f.account);
    if (f.card && f.card !== "all") out = out.eq("card_last4", f.card);
    if (f.category && f.category !== "all") out = out.eq("category", f.category);
    if (f.view === "expense" || f.view === "income" || f.view === "excluded") out = out.eq("pnl_treatment", f.view);
    else if (f.view === "review") out = out.or("pnl_treatment.is.null,pnl_treatment.eq.uncategorized,and(category_source.eq.ai,category_confidence.lt.0.6)");
    if (f.search && f.search.trim()) {
      const term = f.search.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`);
      out = out.ilike("search_text", `%${term}%`);
    }
    return out;
  };

  const countQuery = supabase.from("transactions").select("id", { count: "exact", head: true });
  const rowsQuery = supabase.from("transactions").select(cols);
  applyFilters(countQuery as unknown as FilterBuilder);
  applyFilters(rowsQuery as unknown as FilterBuilder);

  const [countRes, rowsRes] = await Promise.all([
    countQuery,
    rowsQuery
      .order("transaction_date", { ascending: false })
      .order("id", { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1),
  ]);

  if (countRes.error) throw new Error(`Bank txn count failed: ${countRes.error.message}`);
  if (rowsRes.error) throw new Error(`Bank txn page failed: ${rowsRes.error.message}`);
  return { rows: (rowsRes.data ?? []) as BankTxn[], total: countRes.count ?? 0, page, pageSize };
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
