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
type DisputeRow = { id: string; transaction_date: string; amount: number; amount_base: number | null };

export async function getLostDisputesByMonth(
  supabase: SupabaseClient,
  orgId: string,
  from: string,
  to: string
): Promise<Record<string, number>> {
  // Resilience: this feeds the P&L / Bank / Analytics pages. The dispute lookup is
  // index-backed (migration 081) and fast, but we NEVER let it 500 a page — race it
  // against a timeout and fall back to an empty map (chargebacks show 0 that render,
  // self-healing on the next load) rather than letting a slow query take the page down.
  try {
    const rows = await Promise.race([
      drainDisputes(supabase, orgId, from, to),
      new Promise<DisputeRow[]>((_, reject) => setTimeout(() => reject(new Error("dispute query timed out")), 6000)),
    ]);
    const byMonth: Record<string, number> = {};
    for (const r of rows) {
      const k = r.transaction_date.slice(0, 7);
      byMonth[k] = (byMonth[k] ?? 0) + (Number(r.amount_base ?? r.amount) || 0);
    }
    return byMonth;
  } catch (e) {
    console.warn("[getLostDisputesByMonth] falling back to empty:", e instanceof Error ? e.message : e);
    return {};
  }
}

// ─── Dispute (chargeback) FEES ────────────────────────────────────────────────
// The gateway's PENALTY for a chargeback, distinct from the disputed principal
// (getLostDisputesByMonth above). Charged when the dispute is raised, regardless of
// who ultimately wins — so, unlike lost chargebacks, it is a COST (folded into the
// P&L "Dispute Fees" line inside Cost of Revenue), NOT contra-revenue.
//
// The fee is stamped onto the dispute row itself under metadata.dispute_fee, in the
// ROW's presentment currency (same convention as metadata.fee on payment rows):
//   • Stripe   — net of Stripe's balance-transaction fees (charged on creation,
//                reinstated if won → a won-and-refunded fee nets to 0), in the
//                settlement currency (USD for this account) → ×fx_rate to INR.
//   • Cashfree — event_service_charge + event_service_tax from the settlement-recon
//                DISPUTE/CHARGEBACK event, already INR (fx_rate 1).
// Whichever gateways lack a reachable fee source simply carry no dispute_fee and
// contribute 0 — the line self-heals as fees are stamped. Same tiny index-backed
// slice + timeout guard as getLostDisputesByMonth.
const DISPUTE_FEE_NUM = /^-?[0-9]+(\.[0-9]+)?$/;
type DisputeFeeRow = { transaction_date: string; currency: string | null; fx_rate: number | null; metadata: Record<string, unknown> | null };

function disputeFeeInr(r: DisputeFeeRow): number {
  const raw = r.metadata?.["dispute_fee"];
  const s = raw == null ? "" : String(raw);
  if (!DISPUTE_FEE_NUM.test(s)) return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return r.currency && r.currency !== "INR" ? n * (r.fx_rate ?? 1) : n;
}

export async function getDisputeFeesByMonth(
  supabase: SupabaseClient,
  orgId: string,
  from: string,
  to: string
): Promise<Record<string, number>> {
  try {
    const rows = await Promise.race([
      drainDisputeFees(supabase, orgId, from, to),
      new Promise<DisputeFeeRow[]>((_, reject) => setTimeout(() => reject(new Error("dispute-fee query timed out")), 6000)),
    ]);
    const byMonth: Record<string, number> = {};
    for (const r of rows) {
      const fee = disputeFeeInr(r);
      if (fee === 0) continue;
      const k = r.transaction_date.slice(0, 7);
      byMonth[k] = (byMonth[k] ?? 0) + fee;
    }
    return byMonth;
  } catch (e) {
    console.warn("[getDisputeFeesByMonth] falling back to empty:", e instanceof Error ? e.message : e);
    return {};
  }
}

function drainDisputeFees(supabase: SupabaseClient, orgId: string, from: string, to: string): Promise<DisputeFeeRow[]> {
  return selectAllKeyset<DisputeFeeRow & { id: string }>((afterId, limit) => {
    let q = supabase
      .from("transactions")
      .select("id, transaction_date, currency, fx_rate, metadata")
      .eq("org_id", orgId)
      .eq("ledger", "payments")
      .eq("category", "dispute")
      // The fee rides on the dispute row, which follows the connector income toggle
      // (084/085) everywhere disputes are read — keep it consistent so a fee and its
      // dispute row are always both-in or both-out.
      .eq("conn_include_income", true)
      // Only rows that actually carry a stamped fee — keeps the drain tiny. (Uses the
      // same `.or(...not.is.null)` JSON-path form proven elsewhere for metadata->>fee.)
      .or("metadata->>dispute_fee.not.is.null")
      .gte("transaction_date", from)
      .lte("transaction_date", to)
      .order("id", { ascending: true })
      .limit(limit);
    if (afterId) q = q.gt("id", afterId);
    return q as unknown as PromiseLike<{ data: (DisputeFeeRow & { id: string })[] | null; error: { message: string } | null }>;
  });
}

// ─── Dispute → customer identity resolution ───────────────────────────────────
// A dispute row often lacks the customer (esp. Stripe: only metadata.charge). The
// customer lives on the linked charge/payment, so we resolve it for the drill.

export type DisputeIdentity = { name: string | null; email: string | null; phone: string | null };

/** external_id of the charge/payment a dispute is linked to (Stripe: ch_… via
 *  metadata.charge; Razorpay: pay_… via metadata.payment_id). null when none. */
export function disputeLinkId(meta: Record<string, unknown> | null | undefined): string | null {
  if (!meta) return null;
  return (meta.charge as string) || (meta.payment_id as string) || null;
}

/** Look up customer identity (name/email/phone) for a set of charge/payment
 *  external_ids, chunked so the `in()` URL never blows the length limit. */
export async function fetchLinkedIdentities(
  supabase: SupabaseClient,
  orgId: string,
  ids: (string | null)[]
): Promise<Map<string, DisputeIdentity>> {
  const out = new Map<string, DisputeIdentity>();
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  for (let i = 0; i < uniq.length; i += 150) {
    const chunk = uniq.slice(i, i + 150);
    const { data } = await supabase
      .from("transactions")
      .select("external_id, counterparty_name, metadata")
      .eq("org_id", orgId)
      .in("external_id", chunk);
    for (const r of (data ?? []) as { external_id: string; counterparty_name: string | null; metadata: Record<string, unknown> | null }[]) {
      const m = r.metadata ?? {};
      out.set(r.external_id, { name: r.counterparty_name ?? null, email: (m.email as string) ?? null, phone: (m.phone as string) ?? null });
    }
  }
  return out;
}

/** Resolve a dispute row's customer: its own fields first, else the linked charge's. */
export function resolveDisputeIdentity(
  row: { counterparty_name: string | null; metadata: Record<string, unknown> | null },
  linked: Map<string, DisputeIdentity>
): DisputeIdentity {
  const m = row.metadata ?? {};
  const link = linked.get(disputeLinkId(m) ?? "");
  return {
    name: row.counterparty_name ?? link?.name ?? null,
    email: (m.email as string) ?? link?.email ?? null,
    phone: (m.phone as string) ?? link?.phone ?? null,
  };
}

function drainDisputes(supabase: SupabaseClient, orgId: string, from: string, to: string): Promise<DisputeRow[]> {
  return selectAllKeyset<DisputeRow>((afterId, limit) => {
    let q = supabase
      .from("transactions")
      .select("id, transaction_date, amount, amount_base")
      .eq("org_id", orgId)
      .eq("ledger", "payments")
      .eq("category", "dispute")
      // Disputes are contra-revenue → follow the connector income toggle (084/085).
      .eq("conn_include_income", true)
      .gte("transaction_date", from)
      .lte("transaction_date", to)
      // lost only: dispute_status ~ 'lost' OR status='failed' (see doc above)
      .or("metadata->>dispute_status.ilike.*lost*,status.eq.failed")
      .order("id", { ascending: true })
      .limit(limit);
    if (afterId) q = q.gt("id", afterId);
    return q as unknown as PromiseLike<{ data: DisputeRow[] | null; error: { message: string } | null }>;
  });
}
