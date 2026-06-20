import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { backfillMissingBaseAmounts } from "@/lib/fx/rates";

export const maxDuration = 60;

/**
 * GET /api/cron/fx-backfill — fills amount_base (INR) on existing foreign-currency
 * rows that don't have it yet, converting via ECB rates. Runs on a schedule and
 * self-heals: each run drains a bounded batch until nothing remains, then no-ops.
 * This is the right tool for fixing historical FX (the charges are already synced;
 * only the converted figure is missing) — unlike a full re-sync, it can't time out.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  after(async () => {
    try {
      const supabase = await createServiceClient();
      const result = await backfillMissingBaseAmounts(supabase, 3000);
      console.log(`[cron/fx-backfill] updated=${result.updated} remaining=${result.remaining}`);
    } catch (err) {
      console.error("[cron/fx-backfill] failed:", err);
    }
  });

  return NextResponse.json({ message: "fx-backfill started" });
}
