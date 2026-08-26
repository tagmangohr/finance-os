import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { getBankTransactions, type BankTxnFilters } from "@/lib/expenses/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/bank/transactions — one filtered/searched/paginated page of bank-ledger
 * rows for the Bank table. Server-side so the page never ships the whole ledger.
 * Owner/finance-gated (same posture as the Bank page + export).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null && !pageAccess.includes("bank")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const num = (v: string | null, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const view = sp.get("view");
  const filters: BankTxnFilters = {
    from: isDate(sp.get("from")) ? sp.get("from")! : undefined,
    to: isDate(sp.get("to")) ? sp.get("to")! : undefined,
    search: sp.get("search") ?? undefined,
    status: sp.get("status") ?? undefined,
    account: sp.get("account") ?? undefined,
    card: sp.get("card") ?? undefined,
    category: sp.get("category") ?? undefined,
    view: (["all", "expense", "income", "excluded", "review"].includes(view ?? "") ? view : "all") as BankTxnFilters["view"],
    page: Math.max(0, num(sp.get("page"), 0)),
    pageSize: num(sp.get("pageSize"), 50),
  };

  try {
    const sb = await createServiceClient();
    const result = await getBankTransactions(org.id, sb, filters);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load" }, { status: 500 });
  }
}
