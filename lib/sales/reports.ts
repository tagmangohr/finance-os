import type { SupabaseClient } from "@supabase/supabase-js";
import { fyStartISO } from "@/lib/utils";
import { createServiceClient } from "@/lib/supabase/server";
import { cachedOrgLoader } from "@/lib/cache/org-cache";

// ─── Sales tab: flexible, sheet/CSV-fed revenue ledger (ledger='sales') ────────
// Sales rows ride the same transactions table + scalable sync as bank/payments, but
// keep EVERY source column in metadata.raw so the tab can break sales down by any
// column. All aggregation happens in Postgres (sales_overview_agg / sales_dimensions),
// so the page stays fast at 100k+ sales rows — never draining rows into JS.

export type SalesOverview = {
  total: number;                                   // net sales in range (INR base)
  orders: number;                                  // # sale rows (credits)
  aov: number;                                     // average order value
  txnCount: number;
  byMonth: { month: string; amount: number }[];    // monthly trend
  byDimension: { value: string; amount: number; count: number }[]; // top-20 for `dimension`
  dimensions: string[];                            // all detected source columns
  dimension: string | null;                        // the column broken down above
  period: { from: string; to: string };
};

/**
 * Everything the Sales tab renders, in two indexed RPC calls. `dimension` is the
 * source column to break sales down by (defaults to the first detected column).
 * MUST use the SERVICE client (sales rows carry PII and aren't client-readable).
 */
export async function getSalesOverview(
  orgId: string,
  supabase: SupabaseClient,
  opts?: { from?: string; to?: string; dimension?: string }
): Promise<SalesOverview> {
  const today = new Date().toISOString().slice(0, 10);
  const periodFrom = opts?.from || fyStartISO(new Date());
  const periodTo = opts?.to || today;

  // Detected columns first (so we can default the breakdown to a real column).
  const dimsRes = await supabase.rpc("sales_dimensions" as never, { p_org: orgId } as never);
  const dimensions = ((dimsRes as { data: string[] | null }).data ?? []).filter(Boolean);
  const dimension =
    opts?.dimension && dimensions.includes(opts.dimension) ? opts.dimension : (dimensions[0] ?? null);

  const aggRes = await supabase.rpc("sales_overview_agg" as never, {
    p_org: orgId, p_from: periodFrom, p_to: periodTo, p_dim: dimension ?? "",
  } as never);

  type Agg = {
    total: number; orders: number; txnCount: number;
    byMonth: { month: string; amount: number }[];
    byDimension: { value: string; amount: number; count: number }[];
  };
  const agg = ((aggRes as { data: Agg | null }).data ?? {
    total: 0, orders: 0, txnCount: 0, byMonth: [], byDimension: [],
  }) as Agg;

  const total = Number(agg.total) || 0;
  const orders = Number(agg.orders) || 0;
  return {
    total,
    orders,
    aov: orders > 0 ? total / orders : 0,
    txnCount: Number(agg.txnCount) || 0,
    byMonth: (agg.byMonth ?? []).map((m) => ({ month: m.month, amount: Number(m.amount) || 0 })),
    byDimension: (agg.byDimension ?? []).map((d) => ({ value: d.value, amount: Number(d.amount) || 0, count: Number(d.count) || 0 })),
    dimensions,
    dimension,
    period: { from: periodFrom, to: periodTo },
  };
}

export const getSalesOverviewCached = cachedOrgLoader(
  async (orgId: string, opts?: { from?: string; to?: string; dimension?: string }): Promise<SalesOverview> => {
    const supabase = await createServiceClient();
    return getSalesOverview(orgId, supabase, opts);
  },
  ["sales-overview"]
);

/** Whether the org has ANY sales-ledger rows (drives the empty state). */
export async function hasSalesRows(orgId: string, supabase: SupabaseClient): Promise<boolean> {
  const { count } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("ledger", "sales");
  return (count ?? 0) > 0;
}

// ─── Paginated transaction table (server-side) ────────────────────────────────

export type SalesTxn = {
  id: string;
  transaction_date: string;
  transaction_at: string | null;
  amount: number;
  currency: string;
  amount_base: number | null;
  counterparty_name: string | null;
  description: string | null;
  account_type: string | null;                 // = source tab name
  status: string;
  raw: Record<string, unknown>;                // metadata.raw = all source columns
};

export type SalesTxnFilters = {
  from?: string;
  to?: string;
  search?: string;
  source?: string;                             // account_type (tab)
  page?: number;
  pageSize?: number;
};

export type SalesTxnPage = { rows: SalesTxn[]; total: number; page: number; pageSize: number };

/**
 * One filtered/searched/paginated page of sales rows. Newest first. MUST use the
 * service client. Each page is a bounded LIMIT over the partial sales index, so it
 * scales independent of ledger size. `raw` carries every source column so the table
 * can render arbitrary columns without a schema change.
 */
export async function getSalesTransactions(
  orgId: string,
  supabase: SupabaseClient,
  f: SalesTxnFilters
): Promise<SalesTxnPage> {
  const today = new Date().toISOString().slice(0, 10);
  const from = f.from || fyStartISO(new Date());
  const to = f.to || today;
  const page = Math.max(0, f.page ?? 0);
  const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 50));

  type FilterBuilder = {
    eq: (c: string, v: string) => FilterBuilder;
    gte: (c: string, v: string) => FilterBuilder;
    lte: (c: string, v: string) => FilterBuilder;
    ilike: (c: string, v: string) => FilterBuilder;
  };
  const applyFilters = (q: FilterBuilder): FilterBuilder => {
    let out = q.eq("org_id", orgId).eq("ledger", "sales").gte("transaction_date", from).lte("transaction_date", to);
    if (f.source && f.source !== "all") out = out.eq("account_type", f.source);
    if (f.search && f.search.trim()) {
      const term = f.search.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`);
      out = out.ilike("search_text", `%${term}%`);
    }
    return out;
  };

  const cols = "id, transaction_date, transaction_at, amount, currency, amount_base, counterparty_name, description, account_type, status, metadata";
  const countQuery = supabase.from("transactions").select("id", { count: "exact", head: true });
  const rowsQuery = supabase.from("transactions").select(cols);
  applyFilters(countQuery as unknown as FilterBuilder);
  applyFilters(rowsQuery as unknown as FilterBuilder);

  const [countRes, rowsRes] = await Promise.all([
    countQuery,
    rowsQuery
      // Newest first by real timestamp (see getBankTransactions) — date-only rows
      // trail same-day timestamped ones; id breaks ties deterministically.
      .order("transaction_date", { ascending: false })
      .order("transaction_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1),
  ]);

  if (countRes.error) throw new Error(`Sales txn count failed: ${countRes.error.message}`);
  if (rowsRes.error) throw new Error(`Sales txn page failed: ${rowsRes.error.message}`);

  const rows: SalesTxn[] = (rowsRes.data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const raw = (meta.raw ?? {}) as Record<string, unknown>;
    return {
      id: row.id as string,
      transaction_date: row.transaction_date as string,
      transaction_at: (row.transaction_at as string | null) ?? null,
      amount: Number(row.amount) || 0,
      currency: (row.currency as string) ?? "INR",
      amount_base: row.amount_base == null ? null : Number(row.amount_base),
      counterparty_name: (row.counterparty_name as string | null) ?? null,
      description: (row.description as string | null) ?? null,
      account_type: (row.account_type as string | null) ?? null,
      status: (row.status as string) ?? "completed",
      raw,
    };
  });
  return { rows, total: countRes.count ?? 0, page, pageSize };
}

/** Distinct source tabs (account_type) among the org's sales rows — for the filter. */
export async function getSalesSources(orgId: string, supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase
    .from("transactions")
    .select("account_type")
    .eq("org_id", orgId)
    .eq("ledger", "sales")
    .not("account_type", "is", null)
    .limit(1000);
  return Array.from(new Set((data ?? []).map((r) => (r.account_type as string) || "").filter(Boolean))).sort();
}
