import { NextRequest, NextResponse, after } from "next/server";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { drainSyncJobs } from "@/lib/connectors/jobs";

export const maxDuration = 60;

/**
 * GET /api/cron/process-sync-jobs — drains the background sync queue.
 *
 * Returns immediately and drains in `after()` (background), so on-demand callers
 * (the backfill kick) get a fast response and never block on the up-to-50s drain.
 * The function stays alive until the after() callback finishes (within
 * maxDuration). Runs every minute via cron and is kicked after each backfill.
 * Concurrent/overlapping invocations are safe: jobs are claimed with
 * FOR UPDATE SKIP LOCKED, so two workers never grab the same job.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const worker = randomUUID();
  after(async () => {
    try {
      const supabase = await createServiceClient();
      const summary = await drainSyncJobs(supabase, worker);

      // Keep the queue table tidy — finished jobs older than 7 days are history.
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      await supabase
        .from("sync_jobs")
        .delete()
        .in("status", ["done", "failed"])
        .lt("updated_at", cutoff);

      console.log(
        `[cron/process-sync-jobs] worker=${worker} processed=${summary.processed} ` +
        `done=${summary.done} failed=${summary.failed} progressed=${summary.progressed}`
      );
    } catch (err) {
      console.error(`[cron/process-sync-jobs] worker=${worker} drain failed:`, err);
    }
  });

  return NextResponse.json({ message: "draining", worker });
}
