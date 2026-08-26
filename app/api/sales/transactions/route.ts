import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { getSalesTransactions, type SalesTxnFilters } from "@/lib/sales/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/sales/transactions — one filtered/searched/paginated page of sales-ledger
 * rows for the Sales table. Server-side so the page never ships the whole ledger.
 * Owner/finance-gated (same posture as the Sales page).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null && !pageAccess.includes("sales")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const num = (v: string | null, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const filters: SalesTxnFilters = {
    from: isDate(sp.get("from")) ? sp.get("from")! : undefined,
    to: isDate(sp.get("to")) ? sp.get("to")! : undefined,
    search: sp.get("search") ?? undefined,
    source: sp.get("source") ?? undefined,
    page: Math.max(0, num(sp.get("page"), 0)),
    pageSize: num(sp.get("pageSize"), 50),
  };

  try {
    const sb = await createServiceClient();
    const result = await getSalesTransactions(org.id, sb, filters);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load" }, { status: 500 });
  }
}
