import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org/active-org";
import { createServiceClient } from "@/lib/supabase/server";
import { categorizeBankTransactions } from "@/lib/expenses/categorize";
import { invalidateOrg } from "@/lib/cache/org-cache";

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
    // Sweep the backlog in BOUNDED keyset chunks instead of one unbounded drain, so a
    // large uncategorized backlog can never pull every row into memory / blow the budget.
    // Each chunk is capped at CHUNK rows; the keyset cursor advances monotonically (past
    // rows left uncategorized too), so the loop always terminates. Time-boxed under
    // maxDuration so the request returns cleanly; any remainder is reported (and the
    // nightly reconcile's background categorize job + a re-click finish it).
    const CHUNK = 1000;
    const BUDGET_MS = 240_000; // headroom under maxDuration=300
    const started = Date.now();
    // `remaining` stays a COUNT (rows scanned but left for manual review) so the client's
    // "N left for manual review" message keeps working; `moreToScan` is the separate
    // signal that the budget cut the sweep short with backlog still unscanned.
    const totals = { scanned: 0, systemApplied: 0, ruleApplied: 0, aiApplied: 0, remaining: 0, aiUsed: false };
    let cursor: { date: string; id: string } | null = null;
    let hasMore = true;
    do {
      const r = await categorizeBankTransactions(org.id, sb, {
        limit: CHUNK, afterDate: cursor?.date ?? null, afterId: cursor?.id ?? null,
      });
      totals.scanned += r.scanned;
      totals.systemApplied += r.systemApplied;
      totals.ruleApplied += r.ruleApplied;
      totals.aiApplied += r.aiApplied;
      totals.remaining += r.remaining;
      totals.aiUsed = totals.aiUsed || r.aiUsed;
      hasMore = !!r.hasMore;
      cursor = r.nextCursor ?? null;
    } while (hasMore && cursor && Date.now() - started < BUDGET_MS);
    // User-initiated → immediate (synchronous) revalidation so the Bank cards +
    // "Needs review" update on the first reload, not the second.
    invalidateOrg(org.id, { immediate: true });
    return NextResponse.json({ ok: true, ...totals, moreToScan: hasMore });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Categorization failed" },
      { status: 500 }
    );
  }
}
