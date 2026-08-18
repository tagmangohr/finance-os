import { NextRequest, NextResponse } from "next/server";
import { isAuthFailure, requireOrgRead } from "@/lib/api/auth";
import { getPaymentsAccessForOrg } from "@/lib/org/page-access";
import { sanitizeSearchTerm } from "@/lib/api/validation";

// Zeroed summary — returned to search-only members so book-wide totals never leak.
const EMPTY_SUMMARY = {
  cards: { payments: { count: 0, amount: 0 }, settlements: { count: 0, amount: 0 }, refunds: { count: 0, amount: 0 }, disputes: { count: 0, amount: 0 } },
  groups: {}, totalCredits: 0, totalDebits: 0, totalFees: 0, net: 0, total: 0,
};
import { POSTED_TRANSACTION_STATUSES, isTransferSource, categorizeSource } from "@/lib/finance/transaction-status";

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

  const auth = await requireOrgRead(orgId);
  if (isAuthFailure(auth)) return auth.error;
  const access = await getPaymentsAccessForOrg(orgId);
  if (!access.allowed) {
    return NextResponse.json({ error: "Forbidden — no access to Payments" }, { status: 403 });
  }
  // Search-only members never see aggregate totals — return a zeroed summary.
  if (access.searchOnly) return NextResponse.json(EMPTY_SUMMARY);

  // Per-source tallies drive ONLY the source-filter dropdown — kept over all
  // non-failed rows so every source the user can filter on appears.
  const groups: Record<string, { count: number; amount: number }> = {};
  // Card totals — see the locked spec above.
  const payments    = { count: 0, amount: 0 };
  const settlements = { count: 0, amount: 0 };
  const refunds     = { count: 0, amount: 0 };
  const disputes    = { count: 0, amount: 0 };
  let totalFees = 0, totalCredits = 0, totalDebits = 0, totalPayments = 0, operationalDebits = 0, total = 0;

  // ── Single DB-side aggregation ──────────────────────────────────────────────
  // transactions_summary_groups collapses every matching row into a small grouped
  // set (source × category × status × type) with count / Σ base-INR / Σ fee-INR.
  // We then reduce those few dozen rows with the EXACT locked card logic below —
  // identical numbers to the old per-row pass, but ONE query instead of paging
  // through tens of thousands of rows (which timed out on long ranges).
  const { data: groupRows, error } = await auth.supabase.rpc("transactions_summary_groups", {
    p_org:       auth.org.id,
    p_connector: connectorId,
    p_source:    source,
    p_type:      type,
    p_from:      from ? from.slice(0, 10) : null,
    p_to:        to ? to.slice(0, 10) : null,
    p_search:    search || null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type GroupRow = { source: string; category: string | null; status: string; type: string; cnt: number | string; sum_base: number | string; sum_fee: number | string };
  for (const g of (groupRows ?? []) as GroupRow[]) {
    const src      = g.source;
    const cat      = categorizeSource(src);
    const status   = g.status;
    const cnt      = Number(g.cnt);
    const sumBase  = Number(g.sum_base);
    const sumFee   = Number(g.sum_fee);
    const transfer = isTransferSource(src);
    const posted   = POSTED_TRANSACTION_STATUSES.includes(status);

    // Disputes: every dispute raised, ANY status (open/won/lost) — keyed on the
    // category column (set by all gateways) so 'lost' disputes that map to a
    // failed status are still counted.
    if (g.category === "dispute") { disputes.count += cnt; disputes.amount += sumBase; }

    // Everything below excludes failed rows (no money moved) — main-pass parity.
    if (status === "failed") continue;

    // Source dropdown list (all non-failed rows).
    (groups[src] ??= { count: 0, amount: 0 });
    groups[src].count  += cnt;
    groups[src].amount += sumBase;

    // Card totals — terminal status only (no pending).
    if (cat === "payment" && posted)                         { payments.count    += cnt; payments.amount    += sumBase; }
    else if (cat === "settlement" && status === "completed") { settlements.count += cnt; settlements.amount += sumBase; }
    else if (cat === "refund" && status === "completed")     { refunds.count     += cnt; refunds.amount     += sumBase; }

    total += cnt;

    // Financial totals (net / credits / debits / fees) — POSTED rows only.
    if (!posted) continue;
    if (g.type === "credit") {
      totalCredits += sumBase;
      if (!transfer && g.category !== "settlement") totalPayments += sumBase;
    } else {
      totalDebits += sumBase;
      if (!transfer) operationalDebits += sumBase;
    }
    if (!transfer) totalFees += sumFee;
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
