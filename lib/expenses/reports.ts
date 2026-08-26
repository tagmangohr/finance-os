import type { SupabaseClient } from "@supabase/supabase-js";
import { monthStartISO } from "@/lib/utils";
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
  // Default range = current CALENDAR MONTH (IST); overridable via the date-range
  // picker. The bank ledger is an operational view — people land on it to see this
  // month's activity, not the whole FY-to-date. (Runway/burn/cash below use their own
  // 90-day windows, so this default only scopes the in-range cards.)
  const periodFrom = opts?.from || monthStartISO(new Date());
  const periodTo = opts?.to || today;

  const [categories, aggRes, collectionsByMonth, pgFeesByMonth, lostDisputes, runwayRes] = await Promise.all([
    getCategories(orgId, supabase),
    // Single-query bank aggregation (migration 089): cards / by-category / review
    // count / filter options computed in Postgres in ONE indexed pass, instead of
    // draining every bank row into JS. Flat and fast even at 100k+ rows (the old
    // keyset drain was ~100 round-trips at that volume).
    supabase.rpc("bank_overview_agg" as never, { p_org: orgId, p_from: periodFrom, p_to: periodTo } as never),
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

  // Bank aggregates from the single-query RPC (no row drain). Fall back to zeros if
  // the RPC returns nothing (e.g. migration 089 not applied yet → empty ledger view).
  type Agg = {
    expenses: number; otherIncome: number; excluded: number; uncategorizedCount: number;
    txnCount: number; reviewCount: number;
    byCategory: { category: string | null; amount: number; count: number }[];
    accountTypes: string[]; cards: string[];
  };
  const agg = ((aggRes as { data: Agg | null }).data ?? {
    expenses: 0, otherIncome: 0, excluded: 0, uncategorizedCount: 0, txnCount: 0, reviewCount: 0,
    byCategory: [], accountTypes: [], cards: [],
  }) as Agg;

  let collections = 0;
  for (const v of collMap.values()) collections += v;
  const totals = {
    expenses: Number(agg.expenses) || 0,
    otherIncome: Number(agg.otherIncome) || 0,
    excluded: Number(agg.excluded) || 0,
    uncategorizedCount: Number(agg.uncategorizedCount) || 0,
    collections,
    net: collections + (Number(agg.otherIncome) || 0) - (Number(agg.expenses) || 0),
    txnCount: Number(agg.txnCount) || 0,
  };

  const byCategory = (agg.byCategory ?? [])
    .map((c) => {
      const slug = c.category ?? "uncategorized";
      return { category: slug, label: labelBySlug.get(slug) ?? slug, treatment: "expense", amount: Number(c.amount) || 0, count: Number(c.count) || 0 };
    })
    .sort((a, b) => b.amount - a.amount);

  return {
    categories,
    totals,
    byCategory,
    accountTypes: (agg.accountTypes ?? []).slice().sort(),
    cards: (agg.cards ?? []).slice().sort(),
    reviewCount: Number(agg.reviewCount) || 0,
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

// A PostgREST query builder, typed loosely because count/rows/id/update builders
// have different result types but share exactly these predicate calls.
export type BankFilterBuilder = {
  eq: (c: string, v: string) => BankFilterBuilder;
  gte: (c: string, v: string) => BankFilterBuilder;
  lte: (c: string, v: string) => BankFilterBuilder;
  ilike: (c: string, v: string) => BankFilterBuilder;
  or: (v: string) => BankFilterBuilder;
};

/**
 * The single source of truth for the Bank transaction-table filter predicates.
 * Shared by the paginated table read (getBankTransactions), the "select all
 * matching" id fetch, and any bulk mutation over the filtered set — so what the
 * user sees, selects, and bulk-edits can never drift apart. Applies org + bank
 * ledger + date range + split-parent hiding, then the optional status/account/
 * card/category/view/search filters.
 */
export function applyBankTxnFilters(
  q: BankFilterBuilder,
  orgId: string,
  from: string,
  to: string,
  f: Pick<BankTxnFilters, "status" | "account" | "card" | "category" | "view" | "search">
): BankFilterBuilder {
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
}

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
  // Default range = current calendar month (IST), matching getBankOverview so the
  // table and the cards open on the same window.
  const from = f.from || monthStartISO(new Date());
  const to = f.to || today;
  const page = Math.max(0, f.page ?? 0);
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 50));

  const cols =
    "id, transaction_date, transaction_at, type, amount, currency, amount_base, counterparty_name, description, category, pnl_treatment, category_source, category_confidence, account_type, card_last4, card_holder, status, external_id, split_parent_id";

  const countQuery = supabase.from("transactions").select("id", { count: "exact", head: true });
  const rowsQuery = supabase.from("transactions").select(cols);
  applyBankTxnFilters(countQuery as unknown as BankFilterBuilder, orgId, from, to, f);
  applyBankTxnFilters(rowsQuery as unknown as BankFilterBuilder, orgId, from, to, f);

  const [countRes, rowsRes] = await Promise.all([
    countQuery,
    rowsQuery
      // Newest first by the REAL timestamp, not just the date. transaction_date is
      // date-only, so ordering by it alone left same-day rows in id (UUID) order —
      // effectively random, which buried timestamped feeds (Mercury/Brex) among
      // date-only sheet rows. Order within a day by transaction_at (nulls last, so
      // date-only sheet rows trail the timestamped ones), then id for determinism.
      .order("transaction_date", { ascending: false })
      .order("transaction_at", { ascending: false, nullsFirst: false })
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
