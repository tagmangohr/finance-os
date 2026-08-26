import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { applyBankTxnFilters, type BankFilterBuilder, type BankTxnFilters } from "@/lib/expenses/reports";
import { fyStartISO } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Ceiling for a single "select all matching" action. Well above any realistic
// review backlog; if a filter matches more, the client is told it was capped so it
// never silently applies to fewer rows than the user thinks.
const CAP = 10_000;

/**
 * GET /api/bank/transaction-ids — the ids of ALL bank rows matching the CURRENT
 * table filter (not just the visible page), so the client can "select all N
 * matching" for a bulk categorization in one action. Returns only ids (small
 * payload) using the SAME filter helper as the table, so selection can never drift
 * from what's shown. Owner/finance-gated (same posture as the Bank table).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null && !pageAccess.includes("bank")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const view = sp.get("view");
  const f: Pick<BankTxnFilters, "status" | "account" | "card" | "category" | "view" | "search"> = {
    search: sp.get("search") ?? undefined,
    status: sp.get("status") ?? undefined,
    account: sp.get("account") ?? undefined,
    card: sp.get("card") ?? undefined,
    category: sp.get("category") ?? undefined,
    view: (["all", "expense", "income", "excluded", "review"].includes(view ?? "") ? view : "all") as BankTxnFilters["view"],
  };
  const from = isDate(sp.get("from")) ? sp.get("from")! : fyStartISO(new Date());
  const to = isDate(sp.get("to")) ? sp.get("to")! : new Date().toISOString().slice(0, 10);

  try {
    const sb = await createServiceClient();
    const q = sb.from("transactions").select("id");
    applyBankTxnFilters(q as unknown as BankFilterBuilder, org.id, from, to, f);
    // Bounded fetch: cap + 1 so we can tell the client whether more matched.
    const { data, error } = await q.limit(CAP + 1);
    if (error) throw new Error(error.message);
    const all = (data ?? []).map((r) => r.id as string);
    const capped = all.length > CAP;
    return NextResponse.json({ ids: capped ? all.slice(0, CAP) : all, capped, cap: CAP });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load" }, { status: 500 });
  }
}
