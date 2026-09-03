import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { getBankCategoryGroups, type BankTxnFilters } from "@/lib/expenses/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/bank/drill-groups — the category-drill drawer, grouped by vendor.
 * Same scoping as /api/bank/transactions (org + bank ledger + range + category +
 * view), but returns ONE entry per counterparty (total + count + its line items,
 * newest first) with no 100-row cap. Owner/finance-gated (same as the Bank page).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null && !pageAccess.includes("bank")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const view = sp.get("view");
  const filters: BankTxnFilters = {
    from: isDate(sp.get("from")) ? sp.get("from")! : undefined,
    to: isDate(sp.get("to")) ? sp.get("to")! : undefined,
    status: sp.get("status") ?? undefined,
    category: sp.get("category") ?? undefined,
    view: (["all", "expense", "income", "excluded", "review"].includes(view ?? "") ? view : "all") as BankTxnFilters["view"],
  };

  try {
    const sb = await createServiceClient();
    const result = await getBankCategoryGroups(org.id, sb, filters);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load" }, { status: 500 });
  }
}
