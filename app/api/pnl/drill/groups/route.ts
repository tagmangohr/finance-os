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
  const { data, error } = await supabase.rpc("pnl_drill_groups" as never, {
    p_org: org, p_key: key, p_from: from, p_to: to, p_limit: LIMIT + 1,
  } as never);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = ((data ?? []) as { name: string; amount: number; txn_count: number }[]).map((g) => ({
    name: g.name,
    amount: Number(g.amount) || 0,
    txn_count: Number(g.txn_count) || 0,
  }));
  const hasMore = rows.length > LIMIT;
  return NextResponse.json({ groups: rows.slice(0, LIMIT), hasMore });
}
