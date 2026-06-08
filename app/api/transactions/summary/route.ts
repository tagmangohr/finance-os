import { NextRequest, NextResponse } from "next/server";
import { isAuthFailure, requireOrgAccess } from "@/lib/api/auth";
import { sanitizeSearchTerm } from "@/lib/api/validation";
import { POSTED_TRANSACTION_STATUSES } from "@/lib/finance/transaction-status";

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

  // Fetch only the columns we need for aggregation — no pagination limit
  let query = auth.supabase
    .from("transactions")
    .select("source, type, amount, category, metadata")
    .eq("org_id", auth.org.id)
    .in("status", POSTED_TRANSACTION_STATUSES);

  if (connectorId) query = query.eq("connector_id", connectorId);
  if (source)      query = query.eq("source", source);
  if (type)        query = query.eq("type", type);
  if (from)        query = query.gte("transaction_date", from.slice(0, 10));
  if (to)          query = query.lte("transaction_date", to.slice(0, 10));
  if (search) {
    query = query.or(
      `external_id.ilike.%${search}%,description.ilike.%${search}%,counterparty_name.ilike.%${search}%`
    );
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Aggregate
  const groups: Record<string, { count: number; amount: number }> = {};
  let totalFees = 0;
  let totalCredits = 0;
  let totalDebits = 0;
  // Net Flow = Payments − Refunds − Fees − Disputes (real-time earned, not lagging
  // settlement transfers).  Settlements are excluded because they are not new money
  // — they are Razorpay's delayed bank transfer of already-collected payments.
  let totalPayments = 0;

  for (const row of data ?? []) {
    const key = row.source as string;
    if (!groups[key]) groups[key] = { count: 0, amount: 0 };
    groups[key].count++;
    groups[key].amount += row.amount ?? 0;

    if (row.type === "credit") {
      totalCredits += row.amount ?? 0;
      // Exclude settlement rows — they are bank transfers of already-counted
      // payments, not incremental revenue.
      if (row.category !== "settlement") {
        totalPayments += row.amount ?? 0;
      }
    } else {
      totalDebits += row.amount ?? 0;
    }

    // Extract fees from metadata (inclusive of GST)
    const meta = row.metadata as Record<string, unknown> ?? {};
    const fee = Number(meta.fee ?? meta.fees ?? 0);
    if (!isNaN(fee)) totalFees += fee;
  }

  return NextResponse.json({
    groups,
    totalCredits,
    totalDebits,
    totalFees,
    // Payments − Refunds − Disputes − Fees
    net: totalPayments - totalDebits - totalFees,
    total: (data ?? []).length,
  });
}
