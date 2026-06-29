import { NextRequest, NextResponse } from "next/server";
import { isAuthFailure, requireOrgAccess } from "@/lib/api/auth";
import { hasPageAccessForOrg } from "@/lib/org/page-access";
import { sanitizeSearchTerm } from "@/lib/api/validation";
import { POSTED_TRANSACTION_STATUSES, isTransferSource, categorizeSource } from "@/lib/finance/transaction-status";
import { baseAmt } from "@/lib/utils";

export const maxDuration = 60;

/**
 * GET /api/transactions/summary
 * Same filter params as /api/transactions. Returns the summary-card totals.
 *
 * ── LOCKED CARD LOGIC (do not let this drift) ────────────────────────────────
 * All amounts are INR (baseAmt — amount_base, or amount for INR rows).
 * A row is counted ONLY at a terminal status; `pending` counts toward NOTHING.
 * `failed` counts toward nothing either (no money moved) — the single exception
 * is a dispute, which counts whenever it has been raised (see below).
 *
 *   Payments    — category=payment,    status ∈ {completed, refunded}
 *   Settlements — category=settlement,  status = completed
 *   Refunds     — category=refund,      status = completed
 *   Disputes    — category=dispute,     ALL statuses (open/won/lost): a raised
 *                 dispute is money contested or lost, so it's always shown. (Pulled
 *                 from a category='dispute' query because 'lost' disputes can map to
 *                 a failed status that the main pass filters out.)
 *   Fees        — non-transfer posted rows, Σ metadata.fee (FX-converted to INR)
 *   Net Flow    — posted payments − posted operational debits − fees; transfers
 *                 (gateway payouts/settlements) excluded entirely.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const orgId       = searchParams.get("org_id");
  if (!orgId) return NextResponse.json({ error: "org_id required" }, { status: 400 });

  const connectorId = searchParams.get("connector_id") ?? null;
  const source      = searchParams.get("source") ?? null;
  const type        = searchParams.get("type") ?? null;
  const from        = searchParams.get("from") ?? null;
  const to          = searchParams.get("to") ?? null;
  const search      = sanitizeSearchTerm(searchParams.get("search"));

  const auth = await requireOrgAccess(orgId);
  if (isAuthFailure(auth)) return auth.error;
  if (!(await hasPageAccessForOrg(orgId, "data"))) {
    return NextResponse.json({ error: "Forbidden — no access to Raw Data" }, { status: 403 });
  }

  // Two filtered queries built fresh per page. Stable order is REQUIRED for
  // correct pagination — without it Postgres can shift rows between pages.
  const buildMainQuery = () => {
    let q = auth.supabase
      .from("transactions")
      .select("source, type, amount, amount_base, currency, fx_rate, category, metadata, status")
      .neq("status", "failed"); // failed moves no money — never counted
    if (connectorId) q = q.eq("connector_id", connectorId);
    if (source)      q = q.eq("source", source);
    if (type)        q = q.eq("type", type);
    if (from)        q = q.gte("transaction_date", from.slice(0, 10));
    if (to)          q = q.lte("transaction_date", to.slice(0, 10));
    if (search)      q = q.ilike("search_text", `%${search}%`);
    return q.order("id", { ascending: true });
  };

  // Disputes: every dispute raised, ANY status (open/won/lost). category='dispute'
  // is set by all gateways, so this catches 'lost' disputes that map to a failed
  // status the main pass filters out.
  const buildDisputeQuery = () => {
    let q = auth.supabase
      .from("transactions")
      .select("amount, amount_base, currency, fx_rate")
      .eq("category", "dispute");
    if (connectorId) q = q.eq("connector_id", connectorId);
    if (source)      q = q.eq("source", source);
    if (type)        q = q.eq("type", type);
    if (from)        q = q.gte("transaction_date", from.slice(0, 10));
    if (to)          q = q.lte("transaction_date", to.slice(0, 10));
    if (search)      q = q.ilike("search_text", `%${search}%`);
    return q.order("id", { ascending: true });
  };

  // Per-source tallies drive ONLY the source-filter dropdown — kept over all
  // non-failed rows so every source the user can filter on appears.
  const groups: Record<string, { count: number; amount: number }> = {};
  // Card totals — see the locked spec above.
  const payments    = { count: 0, amount: 0 };
  const settlements = { count: 0, amount: 0 };
  const refunds     = { count: 0, amount: 0 };
  const disputes    = { count: 0, amount: 0 };
  let totalFees = 0, totalCredits = 0, totalDebits = 0, totalPayments = 0, operationalDebits = 0, total = 0;

  const PAGE = 1000;

  // ── Main pass: everything except failed (payments/settlements/refunds, fees,
  //    net flow, and the source dropdown). Disputes are handled separately. ──
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await buildMainQuery().range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = data ?? [];

    for (const row of rows) {
      const amt = baseAmt(row);
      const transfer = isTransferSource(row.source as string);
      const key = row.source as string;
      const status = row.status as string;
      const posted = POSTED_TRANSACTION_STATUSES.includes(status);
      const cat = categorizeSource(key);

      // Source dropdown list (all non-failed rows).
      (groups[key] ??= { count: 0, amount: 0 });
      groups[key].count++;
      groups[key].amount += amt;

      // Card totals — terminal status only (no pending).
      if (cat === "payment" && posted)                  { payments.count++;    payments.amount += amt; }
      else if (cat === "settlement" && status === "completed") { settlements.count++; settlements.amount += amt; }
      else if (cat === "refund" && status === "completed")     { refunds.count++;     refunds.amount += amt; }
      // (disputes intentionally not summed here — counted in the dedicated pass.)

      // Financial totals (net / credits / debits / fees) — POSTED rows only.
      if (!posted) continue;
      if (row.type === "credit") {
        totalCredits += amt;
        if (!transfer && row.category !== "settlement") totalPayments += amt;
      } else {
        totalDebits += amt;
        if (!transfer) operationalDebits += amt;
      }
      if (!transfer) {
        const meta = (row.metadata as Record<string, unknown>) ?? {};
        let fee = Number(meta.fee ?? meta.fees ?? 0);
        if (!isNaN(fee) && fee) {
          if ((row.currency as string) !== "INR") fee *= Number(row.fx_rate ?? 1);
          totalFees += fee;
        }
      }
    }

    total += rows.length;
    if (rows.length < PAGE) break;
  }

  // ── Disputes pass: every dispute raised, ANY status (open/won/lost). Keyed on
  //    category='dispute' (set by all gateways) so 'lost' disputes that map to a
  //    failed status — excluded from the main pass — are still counted. ──
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await buildDisputeQuery().range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = data ?? [];
    for (const row of rows) { disputes.count++; disputes.amount += baseAmt(row); }
    if (rows.length < PAGE) break;
  }

  return NextResponse.json({
    // The four bucket cards — computed server-side per the locked spec.
    cards: { payments, settlements, refunds, disputes },
    groups, // source-filter dropdown only
    totalCredits,
    totalDebits,
    totalFees,
    net: totalPayments - operationalDebits - totalFees,
    total,
  });
}
