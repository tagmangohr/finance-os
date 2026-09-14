import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { hasPageAccessForOrg } from "@/lib/org/page-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // the aggregate scans one org × window; give it headroom

const ISO = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export type LineItem = { month: string; drill_key: string; party: string; amount: number; txn_count: number };

/**
 * GET /api/pnl/lineitems?org=&from=&to=
 * Vendor / gateway line items behind the P&L rows, per month, for the whole
 * window (the "Expand" toggle). Powered by the pnl_lineitems_monthly RPC (111),
 * which reuses the same _dm_* helpers as the category totals so each line's
 * parties sum EXACTLY to that line. Gated on the "pnl" page grant.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const org = req.nextUrl.searchParams.get("org");
  const from = ISO(req.nextUrl.searchParams.get("from"));
  const to = ISO(req.nextUrl.searchParams.get("to"));
  if (!org || !from || !to) return NextResponse.json({ error: "org, from, to required" }, { status: 400 });

  if (!(await hasPageAccessForOrg(org, "pnl"))) {
    return NextResponse.json({ error: "Forbidden — no access to Profit & Loss" }, { status: 403 });
  }

  const supabase = await createServiceClient();
  type Row = { month: string; drill_key: string; party: string; amount: number | null; txn_count: number | null };

  // PostgREST caps each response at db-max-rows (~1000); a full-FY expand can exceed
  // that. Page through the (deterministically ordered — migration 116) result until a
  // short page, so vendor sub-rows always sum to their row total no matter the size.
  const PAGE = 1000;
  const MAX_PAGES = 50; // hard stop (≤50k line items) — a runaway is a bug, not a page
  const rows: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const fromRow = page * PAGE;
    const { data, error } = await supabase
      .rpc("pnl_lineitems_monthly" as never, { p_org: org, p_from: from, p_to: to } as never)
      .range(fromRow, fromRow + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  const items: LineItem[] = rows.map((r) => ({
    month: String(r.month).slice(0, 7),
    drill_key: r.drill_key,
    party: r.party,
    amount: Number(r.amount ?? 0),
    txn_count: Number(r.txn_count ?? 0),
  }));
  return NextResponse.json({ items });
}
