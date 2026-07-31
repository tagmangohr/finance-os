import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { categorizeBankTransactions } from "@/lib/expenses/categorize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Large first-time backlogs go through AI in batches; give the function room.
// Per-batch persistence means even a cutoff keeps progress, but 300s lets a
// click clear a few-thousand-row backlog in one go.
export const maxDuration = 300;

/**
 * POST /api/expenses/categorize — run the two-layer categorizer over this org's
 * uncategorized bank transactions (rules first, then AI if a key is configured).
 * Admin/finance-gated. Fill-only: never touches already-categorized rows.
 */
export async function POST(): Promise<NextResponse> {
  const { org, pageAccess } = await getActiveOrg();
  if (!org) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pageAccess !== null) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const sb = await createServiceClient();
    const result = await categorizeBankTransactions(org.id, sb);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Categorization failed" },
      { status: 500 }
    );
  }
}
