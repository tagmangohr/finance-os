import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyApiKey, bearerFrom } from "@/lib/api-keys";
import { parsePagination, sanitizeSearchTerm } from "@/lib/api/validation";
import { sourceLabel } from "@/lib/finance/transaction-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/v1/payments — partner Payments Search API (server-to-server).
 *
 * Auth:   Authorization: Bearer <org API key>   (minted in Settings → API keys)
 * Scope:  requires the `payments:read` scope; org is derived FROM the key.
 * Model:  SEARCH-ONLY — a `search` term (min 3 chars) is required, else no rows
 *         are returned. Read-only; gateway payments only (bank-ledger excluded);
 *         no card data ever returned.
 *
 * Query params:
 *   search   required, ≥3 chars — matches order id, payment id, UTR/RRN, email, phone, name
 *   from,to  optional ISO dates (transaction date)
 *   limit    default 100, max 500
 *   offset   default 0
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = await createServiceClient();
  const verified = await verifyApiKey(supabase, bearerFrom(req.headers.get("authorization")));
  if (!verified) {
    return NextResponse.json({ error: "Invalid or missing API key" }, { status: 401 });
  }
  if (!verified.scopes.includes("payments:read")) {
    return NextResponse.json({ error: "This key lacks the payments:read scope" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const search = sanitizeSearchTerm(sp.get("search"));
  const { limit, offset } = parsePagination(sp);
  const from = sp.get("from");
  const to = sp.get("to");

  // Search-only: no term, too short, or no real characters → never dump history.
  if (!search || search.trim().length < 3 || !/[a-z0-9]/i.test(search)) {
    return NextResponse.json({ data: [], total: 0, limit, offset, note: "Provide a `search` term of at least 3 characters." });
  }

  // Escape LIKE wildcards so the term is matched LITERALLY. Without this a partner
  // could pass `___` or `%` to match every row — this is a search-ONLY endpoint.
  // Underscores inside real ids (pay_…, cf_pay_…) stay searchable (matched literally).
  const likeTerm = search.replace(/[\\%_]/g, (ch) => `\\${ch}`);

  let query = supabase
    .from("transactions")
    .select(
      `id, transaction_date, transaction_at, source, type, amount, currency, status,
       amount_base, base_currency, counterparty_name, external_id, metadata`,
      { count: "exact" }
    )
    .eq("org_id", verified.org_id)
    .neq("ledger", "bank"); // gateway payments only — never bank-ledger rows

  if (from) query = query.gte("transaction_date", from.slice(0, 10));
  if (to) query = query.lte("transaction_date", to.slice(0, 10));

  query = query
    .ilike("search_text", `%${likeTerm}%`)
    .order("transaction_date", { ascending: false })
    .order("transaction_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string; transaction_date: string; transaction_at: string | null;
    source: string | null; type: string; amount: number | null; currency: string | null;
    status: string | null; amount_base: number | null; base_currency: string | null;
    counterparty_name: string | null; external_id: string | null; metadata: Record<string, unknown> | null;
  };
  const pick = (m: Record<string, unknown> | null, keys: string[]): string | null => {
    for (const k of keys) { const v = m?.[k]; if (typeof v === "string" && v) return v; }
    return null;
  };
  const data_rows = ((data ?? []) as Row[]).map((r) => ({
    id: r.external_id || r.id,
    date: r.transaction_date,
    timestamp: r.transaction_at,
    gateway: sourceLabel(r.source),
    source: r.source,
    type: r.type, // credit = payment, debit = refund/payout
    amount: r.amount != null ? Number(r.amount) : null,
    currency: r.currency,
    amount_inr: r.amount_base != null ? Number(r.amount_base) : null,
    status: r.status,
    customer: {
      name: r.counterparty_name || null,
      email: pick(r.metadata, ["email", "customer_email", "customer_details.customer_email"]),
      phone: pick(r.metadata, ["phone", "contact", "customer_phone", "customer_details.customer_phone"]),
    },
  }));

  return NextResponse.json({ data: data_rows, total: count ?? 0, limit, offset });
}
