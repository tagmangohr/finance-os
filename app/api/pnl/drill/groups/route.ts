import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { hasPageAccessForOrg } from "@/lib/org/page-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const LIMIT = 50;

/**
 * GET /api/pnl/drill/groups?org=&key=&from=&to=
 * Consolidated vendor/customer split of a P&L cell (Postgres-side grouping via
 * pnl_drill_groups). Returns the top LIMIT groups by |amount| + a hasMore flag.
 * Gated on the "pnl" page grant.
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

  // Income cells (customer_payment revenue + Other Income) aren't in the
  // pnl_drill_groups RPC (it's expense/PG only), so group them here directly by
  // counterparty. Small set (bank income rows), so a direct query is fine.
  if (key.startsWith("income:")) {
    const slug = key.slice("income:".length);
    let iq = supabase
      .from("transactions")
      .select("counterparty_name, amount, amount_base, type")
      .eq("org_id", org).eq("ledger", "bank").eq("pnl_treatment", "income")
      .in("status", ["completed", "refunded"])
      .gte("transaction_date", from).lte("transaction_date", to);
    iq = slug && slug !== "uncategorized" ? iq.eq("category", slug) : iq.or("category.is.null,category.eq.");
    const { data: irows, error: ierr } = await iq.limit(5000);
    if (ierr) return NextResponse.json({ error: ierr.message }, { status: 500 });
    const m = new Map<string, { amount: number; count: number }>();
    for (const r of (irows ?? []) as { counterparty_name: string | null; amount: number | null; amount_base: number | null; type: string }[]) {
      const name = (r.counterparty_name ?? "—") || "—";
      const base = Number(r.amount_base ?? r.amount) || 0;
      const signed = r.type === "credit" ? base : -base;
      const e = m.get(name) ?? { amount: 0, count: 0 };
      e.amount += signed; e.count += 1; m.set(name, e);
    }
    const g = [...m.entries()].map(([name, v]) => ({ name, amount: v.amount, txn_count: v.count }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    return NextResponse.json({ groups: g.slice(0, LIMIT), hasMore: g.length > LIMIT });
  }

  const { data, error } = await supabase.rpc("pnl_drill_groups" as never, {
    p_org: org, p_key: key, p_from: from, p_to: to, p_limit: LIMIT + 1,
  } as never);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Gross Revenue also includes bank-collected customer payments — surface each
  // bank PAYER as its own group (name "bank:<customer>") alongside the PG gateways,
  // so the breakup lists individual customers, not one lumped "Bank Collections".
  if (key === "revenue") {
    const { data: bank } = await supabase
      .from("transactions")
      .select("counterparty_name, amount, amount_base, type")
      .eq("org_id", org).eq("ledger", "bank").eq("pnl_treatment", "income").eq("category", "customer_payment")
      .in("status", ["completed", "refunded"])
      .gte("transaction_date", from).lte("transaction_date", to)
      .limit(20000);
    const byCustomer = new Map<string, { amount: number; count: number }>();
    for (const r of (bank ?? []) as { counterparty_name: string | null; amount: number | null; amount_base: number | null; type: string }[]) {
      const name = (r.counterparty_name ?? "—") || "—";
      const base = Number(r.amount_base ?? r.amount) || 0;
      const e = byCustomer.get(name) ?? { amount: 0, count: 0 };
      e.amount += r.type === "credit" ? base : -base; e.count += 1;
      byCustomer.set(name, e);
    }
    const gw = ((data ?? []) as { name: string; amount: number; txn_count: number }[]).map((g) => ({ name: g.name, amount: Number(g.amount) || 0, txn_count: Number(g.txn_count) || 0 }));
    for (const [name, v] of byCustomer) gw.push({ name: `bank:${name}`, amount: v.amount, txn_count: v.count });
    gw.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    return NextResponse.json({ groups: gw.slice(0, LIMIT), hasMore: gw.length > LIMIT });
  }

  const rows = ((data ?? []) as { name: string; amount: number; txn_count: number }[]).map((g) => ({
    name: g.name,
    amount: Number(g.amount) || 0,
    txn_count: Number(g.txn_count) || 0,
  }));
  const hasMore = rows.length > LIMIT;
  return NextResponse.json({ groups: rows.slice(0, LIMIT), hasMore });
}
