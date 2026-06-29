import { NextRequest, NextResponse } from "next/server";
import { isAuthFailure, requireOrgAccess } from "@/lib/api/auth";
import { hasPageAccessForOrg } from "@/lib/org/page-access";
import { sanitizeSearchTerm } from "@/lib/api/validation";
import { POSTED_TRANSACTION_STATUSES, isTransferSource, categorizeSource } from "@/lib/finance/transaction-status";
import { baseAmt } from "@/lib/utils";

export const maxDuration = 60;

/**
 * GET /api/transactions/summary
 * Same filter params as /api/transactions.
 * Returns aggregate counts + amounts per source type plus total fees.
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

  // Build the filtered query fresh each page (Supabase caps a single .select at
  // 1000 rows — summing only the first page made "All accounts" smaller than one
  // connector and nothing reconciled). We page through ALL matching rows and
  // accumulate, so the totals are complete and add up across filters.
  const buildQuery = () => {
    let q = auth.supabase
      .from("transactions")
      .select("source, type, amount, amount_base, currency, fx_rate, category, metadata, status")
      // Per-source card counts include everything EXCEPT failed attempts (so pending
      // settlements/disputes show, matching the table). Financial totals below are
      // gated to POSTED statuses for accuracy — see the loop.
      .neq("status", "failed");
    if (connectorId) q = q.eq("connector_id", connectorId);
    if (source)      q = q.eq("source", source);
    if (type)        q = q.eq("type", type);
    if (from)        q = q.gte("transaction_date", from.slice(0, 10));
    if (to)          q = q.lte("transaction_date", to.slice(0, 10));
    // Search the single search_text blob (external_id + description + counterparty +
    // ALL metadata) — covers order id, raw payment id, UTR/RRN, email, etc.
    if (search) q = q.ilike("search_text", `%${search}%`);
    // Stable order is REQUIRED for correct pagination — without it Postgres can
    // shift rows between pages, double-counting some and skipping others.
    return q.order("id", { ascending: true });
  };

  const groups: Record<string, { count: number; amount: number }> = {};
  let totalFees = 0, totalCredits = 0, totalDebits = 0, totalPayments = 0, operationalDebits = 0, total = 0;
  // Payments card = CAPTURED money only (posted payment-category rows). Tracked
  // apart from `groups` so the source filter + other cards still reflect all
  // non-failed activity, while pending payments never inflate Payments.
  let paymentsPostedCount = 0, paymentsPostedAmount = 0;

  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = data ?? [];

    for (const row of rows) {
      // Sum the base-currency (INR) value, never raw amount.
      const amt = baseAmt(row);
      // Net Flow excludes bank transfers (gateway payouts/settlements) — those
      // move already-counted charge money to the bank, not income/expense.
      const transfer = isTransferSource(row.source as string);
      const key = row.source as string;
      const posted = POSTED_TRANSACTION_STATUSES.includes(row.status as string);

      // Per-source tallies (drive the source filter + the settlement/refund/
      // dispute cards): all non-failed rows, matching the table — unchanged.
      (groups[key] ??= { count: 0, amount: 0 });
      groups[key].count++;
      groups[key].amount += amt;

      // Payments card = CAPTURED money only — a pending payment hasn't been
      // collected, so exclude it from the Payments count AND amount.
      if (posted && categorizeSource(key) === "payment") {
        paymentsPostedCount++;
        paymentsPostedAmount += amt;
      }

      // Financial totals (net / credits / debits / fees) only count POSTED rows —
      // pending settlements/disputes are real activity (shown in the cards above) but
      // must not move Net Flow until settled.
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
          // Fees are stored in the row's own currency (Razorpay = INR, Stripe = USD).
          // Convert non-INR fees to INR with the row's rate, like amount_base.
          if ((row.currency as string) !== "INR") fee *= Number(row.fx_rate ?? 1);
          totalFees += fee;
        }
      }
    }

    total += rows.length;
    if (rows.length < PAGE) break;
  }

  return NextResponse.json({
    groups,
    paymentsPosted: { count: paymentsPostedCount, amount: paymentsPostedAmount },
    totalCredits,
    totalDebits,
    totalFees,
    net: totalPayments - operationalDebits - totalFees,
    total,
  });
}
