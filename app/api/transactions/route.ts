import { NextRequest, NextResponse } from "next/server";
import { isAuthFailure, requireOrgRead } from "@/lib/api/auth";
import { getPaymentsAccessForOrg } from "@/lib/org/page-access";
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

  // Read-side auth: any active member (viewers included) — the real gate is the
  // "data" page permission below. (requireOrgAccess is writable-org = admin/manager
  // only, which wrongly 404'd viewers before this check could run.)
  const auth = await requireOrgRead(orgId);
  if (isAuthFailure(auth)) return auth.error;
  // Raw Data is gated by the "data" page permission — block restricted members
  // from pulling transactions via the API directly.
  const access = await getPaymentsAccessForOrg(orgId);
  if (!access.allowed) {
    return NextResponse.json({ error: "Forbidden — no access to Payments" }, { status: 403 });
  }
  // Search-only members (support/calling teams): NO rows are ever returned
  // without a real search term — enforced here, not just in the UI.
  if (access.searchOnly && (!search || search.trim().length < 3)) {
    return NextResponse.json({ rows: [], total: 0, limit, offset });
  }

  let query = auth.supabase
    .from("transactions")
    .select(
      `id, transaction_date, transaction_at, source, type, amount, currency, status,
       amount_base, base_currency, fx_rate,
       counterparty_name, description, external_id, category, metadata,
       connector_id,
       connectors!inner(name, type)`,
      // EXACT count. It stays fast at scale because of the partial index
      // idx_txn_payments_explorer (migration 095) — WHERE ledger='payments' over
      // (org_id, transaction_date desc, source, type, connector_id) — which lets
      // Postgres satisfy this count with an index-only scan of narrow entries
      // instead of a sequential scan of the wide raw-jsonb heap. (The 8s timeouts
      // that broke this page were a planner regression from dead-tuple bloat +
      // stale stats; a VACUUM (ANALYZE) + this index remove them.)
      { count: "exact" }
    )
    .eq("org_id", auth.org.id)
    // Firewall: the Payments explorer shows PG/gateway money only. Bank-ledger
    // rows (Mercury) live in the Bank tab and sales-ledger rows in the Sales tab —
    // neither belongs here, so scope to payments explicitly.
    .eq("ledger", "payments");

  if (connectorId) query = query.eq("connector_id", connectorId);
  if (source)      query = query.eq("source", source);
  if (type)        query = query.eq("type", type);
  if (from)        query = query.gte("transaction_date", from.slice(0, 10));
  if (to)          query = query.lte("transaction_date", to.slice(0, 10));

  // Search the single search_text blob (external_id + description + counterparty +
  // ALL metadata) — covers order id, raw payment id, UTR/RRN, email, phone, etc.
  if (search) query = query.ilike("search_text", `%${search}%`);

  // Primary sort is the chosen column. When sorting by date, tie-break by the
  // full timestamp so rows within the same day are ordered by time (not arbitrary
  // PostgREST order) — null-time rows (CSV/historical) sink to the end of the day.
  // A final id tiebreaker makes the order fully deterministic and pagination-safe.
  query = query.order(sortCol, { ascending });
  if (sortCol === "transaction_date") {
    query = query.order("transaction_at", { ascending, nullsFirst: false });
  }
  query = query
    .order("id", { ascending: false })
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
