import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllKeyset } from "@/lib/supabase/paginate";

/**
 * Lost chargebacks/disputes, bucketed by month ('YYYY-MM'), in base currency (INR).
 *
 * A dispute the merchant LOST is money that actually left — economically a refund —
 * yet the dashboard/P&L rollups classify `category='dispute'` OUTSIDE both refunds
 * and expenses, so these losses never reached Net Profit. This surfaces them as a
 * contra-revenue line on the P&L (and nets them out of Bank collections so the two
 * pages still tie).
 *
 * "Lost" across gateways (Stripe maps BOTH won & lost to status='completed', so
 * status alone is insufficient):
 *   • metadata.dispute_status contains "lost"  → Stripe 'lost', Cashfree
 *     '*_MERCHANT_LOST', Razorpay 'Lost'; OR
 *   • status='failed'                          → Cashfree/Razorpay lost outcomes
 *     (incl. older rows with no dispute_status). Stripe never sets a dispute to
 *     'failed', so won/pending Stripe rows can't slip in here.
 * Won (kept the money) and pending (undecided) are deliberately excluded.
 *
 * Disputes are a tiny slice of the ledger (hundreds of rows), so a keyset drain is
 * cheap — no rollup/migration needed. amount_base is populated for every dispute
 * (foreign-currency disputes are FX-converted on ingest), so the INR figure is exact.
 */
export async function getLostDisputesByMonth(
  supabase: SupabaseClient,
  orgId: string,
  from: string,
  to: string
): Promise<Record<string, number>> {
  type Row = { id: string; transaction_date: string; amount: number; amount_base: number | null };
  const rows = await selectAllKeyset<Row>((afterId, limit) => {
    let q = supabase
      .from("transactions")
      .select("id, transaction_date, amount, amount_base")
      .eq("org_id", orgId)
      .eq("ledger", "payments")
      .eq("category", "dispute")
      .gte("transaction_date", from)
      .lte("transaction_date", to)
      // lost only: dispute_status ~ 'lost' OR status='failed' (see doc above)
      .or("metadata->>dispute_status.ilike.*lost*,status.eq.failed")
      .order("id", { ascending: true })
      .limit(limit);
    if (afterId) q = q.gt("id", afterId);
    return q as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
  });

  const byMonth: Record<string, number> = {};
  for (const r of rows) {
    const k = r.transaction_date.slice(0, 7);
    byMonth[k] = (byMonth[k] ?? 0) + (Number(r.amount_base ?? r.amount) || 0);
  }
  return byMonth;
}
