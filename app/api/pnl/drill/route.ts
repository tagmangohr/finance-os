import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { hasPageAccessForOrg } from "@/lib/org/page-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const LIMIT = 100;

type Row = {
  id: string;
  transaction_date: string;
  counterparty_name: string | null;
  amount: number | null;
  amount_base: number | null;
  currency: string | null;
  fx_rate: number | null;
  source: string | null;
  status: string | null;
  category: string | null;
  type: string;
  metadata: Record<string, unknown> | null;
  ledger: string | null;
};

const FEE_NUM = /^-?[0-9]+(\.[0-9]+)?$/;
function feeInr(r: Row): number {
  const raw = (r.metadata?.["fee"] ?? r.metadata?.["fees"]) as unknown;
  const s = raw == null ? "" : String(raw);
  if (!FEE_NUM.test(s)) return 0;
  const n = Number(s);
  return r.currency && r.currency !== "INR" ? n * (r.fx_rate ?? 1) : n;
}

/**
 * GET /api/pnl/drill?org=&key=&from=&to=
 * Returns a SAMPLE page (first 100 by date) of the transactions behind a P&L cell,
 * plus the exact matching count. The authoritative rupee total is the rollup value
 * shown by the client — we never re-sum the raw table here (that's the timeout we
 * designed the rollup to avoid). Gated on the "pnl" page grant.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const org = req.nextUrl.searchParams.get("org");
  const key = req.nextUrl.searchParams.get("key");
  const from = ISO(req.nextUrl.searchParams.get("from"));
  const to = ISO(req.nextUrl.searchParams.get("to"));
  if (!org || !key || !from || !to) return NextResponse.json({ error: "org, key, from, to required" }, { status: 400 });

  if (!(await hasPageAccessForOrg(org, "pnl"))) {
    return NextResponse.json({ error: "Forbidden — no access to Profit & Loss" }, { status: 403 });
  }

  const supabase = await createServiceClient();
  const cols = "id, transaction_date, counterparty_name, amount, amount_base, currency, fx_rate, source, status, category, type, metadata, ledger";
  let q = supabase
    .from("transactions")
    .select(cols, { count: "exact" })
    .eq("org_id", org)
    .gte("transaction_date", from)
    .lte("transaction_date", to);

  if (key === "revenue") {
    q = q.eq("type", "credit").eq("ledger", "payments").in("status", ["completed", "refunded"]);
  } else if (key === "refunds") {
    q = q.eq("ledger", "payments").or("and(type.eq.debit,category.eq.refund),and(type.eq.credit,status.eq.refunded)");
  } else if (key === "__pg_fees__") {
    q = q.in("status", ["completed", "refunded"]).or("metadata->>fee.not.is.null,metadata->>fees.not.is.null");
  } else {
    // An expense category slug (or 'uncategorized').
    q = q.in("status", ["completed", "refunded"]).or("and(ledger.eq.bank,pnl_treatment.eq.expense),and(ledger.eq.payments,type.eq.debit)");
    if (key === "uncategorized") q = q.or("category.is.null,category.eq.");
    else q = q.eq("category", key);
  }

  const { data, count, error } = await q.order("transaction_date", { ascending: false }).limit(LIMIT);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const raw = (data ?? []) as unknown as Row[];
  const rows = raw.map((r) => {
    const isFee = key === "__pg_fees__";
    const base = Number(r.amount_base ?? r.amount ?? 0);
    // Expense rows: bank reversals (credit) net off, so show them signed.
    const signed = key !== "revenue" && key !== "refunds" && !isFee && r.type === "credit" ? -base : base;
    return {
      id: r.id,
      transaction_date: r.transaction_date,
      counterparty_name: r.counterparty_name,
      amount: signed,
      currency: "INR",
      source: r.source,
      status: r.status,
      category: r.category,
      type: r.type,
      fee: isFee ? Number(feeInr(r).toFixed(2)) : null,
    };
  });

  return NextResponse.json({ rows, count: count ?? rows.length });
}
