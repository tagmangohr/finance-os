import { NextRequest, NextResponse } from "next/server";
import { isAuthFailure, requireOrgAccess } from "@/lib/api/auth";
import {
  parsePagination,
  parseTransactionSort,
  sanitizeSearchTerm,
} from "@/lib/api/validation";

// ─── GET /api/transactions ────────────────────────────────────────────────────
// Query params:
//   org_id       required
//   connector_id optional — filter to one connector
//   source       optional — e.g. razorpay | razorpay_refund | stripe
//   type         optional — credit | debit
//   from         optional — ISO date string
//   to           optional — ISO date string
//   search       optional — matches external_id, description, counterparty_name
//   limit        default 100, max 500
//   offset       default 0
//   sort         default transaction_date
//   order        asc | desc (default desc)

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;

  const orgId = searchParams.get("org_id");
  if (!orgId) {
    return NextResponse.json({ error: "org_id is required" }, { status: 400 });
  }

  const connectorId = searchParams.get("connector_id") ?? null;
  const source      = searchParams.get("source") ?? null;
  const type        = searchParams.get("type") ?? null;
  const from        = searchParams.get("from") ?? null;
  const to          = searchParams.get("to") ?? null;
  const search      = sanitizeSearchTerm(searchParams.get("search"));
  const { limit, offset } = parsePagination(searchParams);
  const { sortCol, ascending } = parseTransactionSort(searchParams);

  const auth = await requireOrgAccess(orgId);
  if (isAuthFailure(auth)) return auth.error;

  let query = auth.supabase
    .from("transactions")
    .select(
      `id, transaction_date, source, type, amount, currency, status,
       counterparty_name, description, external_id, category, metadata,
       connector_id,
       connectors!inner(name, type)`,
      { count: "exact" }
    )
    .eq("org_id", auth.org.id);

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

  query = query
    .order(sortCol, { ascending })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    rows: data ?? [],
    total: count ?? 0,
    limit,
    offset,
  });
}
