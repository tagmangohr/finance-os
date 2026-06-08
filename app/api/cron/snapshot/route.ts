import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { calculateRevenue } from "@/lib/intelligence/revenue";
import { calculateRunway } from "@/lib/intelligence/runway";
import { calculateBurnRate } from "@/lib/intelligence/burn-rate";
import { calculateCollections } from "@/lib/intelligence/collections";

/**
 * GET /api/cron/snapshot
 *
 * Computes financial intelligence for every org that has at least one active
 * connector and upserts a row into financial_snapshots.  This populates the
 * Ticker tape (Cash / MRR / Burn / Runway) and provides the historical data
 * used for MoM sparklines and trend comparisons.
 *
 * Note: burn_rate currently reflects only gateway outflows (refunds /
 * disputes).  It will be more accurate once an accounting connector
 * (Tally, QuickBooks, etc.) is added as those carry true operational expenses.
 *
 * Schedule: daily at 02:00 UTC via Vercel cron.
 * Can also be triggered manually: GET /api/cron/snapshot
 *   with header  Authorization: Bearer <CRON_SECRET>
 */
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceClient();

  // Get all orgs that have at least one active connector
  const { data: activeConnectors, error: connErr } = await supabase
    .from("connectors")
    .select("org_id")
    .eq("status", "active");

  if (connErr) {
    return NextResponse.json({ error: connErr.message }, { status: 500 });
  }

  const orgIds = [...new Set((activeConnectors ?? []).map((c) => c.org_id))];

  if (orgIds.length === 0) {
    return NextResponse.json({ message: "No active orgs", processed: 0 });
  }

  const today = new Date().toISOString().split("T")[0];

  const results = await Promise.allSettled(
    orgIds.map(async (orgId) => {
      // Run all intelligence primitives in parallel per org
      const [revenue, runway, burnRate, collections] = await Promise.all([
        calculateRevenue(orgId, supabase),
        calculateRunway(orgId, supabase),
        calculateBurnRate(orgId, supabase),
        calculateCollections(orgId, supabase),
      ]);

      const { error } = await supabase
        .from("financial_snapshots")
        .upsert(
          {
            org_id:              orgId,
            snapshot_date:       today,
            mrr:                 revenue.mrr,
            arr:                 revenue.arr,
            burn_rate:           runway.burn_rate,
            cash_balance:        runway.cash_balance,
            runway_days:         runway.runway_days,
            total_revenue_mtd:   revenue.by_month[revenue.by_month.length - 1]?.amount ?? 0,
            total_expenses_mtd:  burnRate.current_month,
            accounts_receivable: collections.total_outstanding,
            accounts_payable:    0,
            collection_rate:     collections.collection_rate,
          },
          { onConflict: "org_id,snapshot_date" }
        );

      if (error) throw new Error(error.message);
      return orgId;
    })
  );

  const summary = results.map((r, i) => ({
    orgId:  orgIds[i],
    status: r.status,
    error:  r.status === "rejected" ? String(r.reason) : undefined,
  }));

  console.log(`[cron/snapshot] ${new Date().toISOString()} — processed ${orgIds.length} orgs`);

  return NextResponse.json({
    message:   "OK",
    processed: orgIds.length,
    detail:    summary,
  });
}
