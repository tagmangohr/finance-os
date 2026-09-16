import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { refreshMercuryBalances } from "@/lib/expenses/mercury-balances";
import { logCronRun } from "@/lib/ops/cron-runs";
import { isCronEnabled } from "@/lib/ops/cron-settings";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/mercury-balances — refresh stored Mercury account balances (incl.
 * Treasury) for every active Mercury connector.
 *
 * This used to live at the TAIL of nightly-sync's after() (behind drain + Cashfree
 * fee reconcile + subscription/invoice syncs), where it could be starved and never
 * run — leaving the Bank cash position weeks stale AND missing the Treasury account
 * entirely (a large understatement). Splitting it into its own small, isolated cron
 * with its own budget makes it run reliably, and records the outcome to cron_runs so
 * a failure is visible on Sync Health instead of hidden. Idempotent upsert keyed on
 * (connector_id, account_id).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  after(async () => {
    const startedAt = Date.now();
    const supabase = await createServiceClient();
    // Paused via the Sync Health toggle → no-op (no run logged; the page shows it "off").
    if (!(await isCronEnabled(supabase, "mercury-balances"))) return;
    try {
      const { data: conns } = await supabase
        .from("connectors")
        .select("id, org_id, config")
        .eq("type", "mercury")
        .eq("status", "active");

      let accountsRefreshed = 0;
      const errors: string[] = [];
      for (const c of conns ?? []) {
        try {
          accountsRefreshed += await refreshMercuryBalances(supabase, {
            id: c.id as string, org_id: c.org_id as string, config: c.config as Record<string, unknown> | null,
          });
        } catch (e) {
          errors.push(`${c.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      await logCronRun(
        supabase, "mercury-balances", startedAt,
        errors.length ? "failed" : "ok",
        errors[0] ?? null,
        { connectors: (conns ?? []).length, accounts_refreshed: accountsRefreshed, errors: errors.length },
      );
      console.log(`[cron/mercury-balances] connectors=${(conns ?? []).length} accounts_refreshed=${accountsRefreshed} errors=${errors.length}`);
    } catch (err) {
      await logCronRun(supabase, "mercury-balances", startedAt, "failed", err instanceof Error ? err.message : String(err));
      console.error("[cron/mercury-balances] failed:", err);
    }
  });

  return NextResponse.json({ ok: true });
}
