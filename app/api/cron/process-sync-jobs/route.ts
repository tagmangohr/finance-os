import { NextRequest, NextResponse, after } from "next/server";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { drainSyncJobs } from "@/lib/connectors/jobs";
import { logCronRun } from "@/lib/ops/cron-runs";
import { isCronEnabled } from "@/lib/ops/cron-settings";

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

  // A `chain=1` invocation is an internal self-chained drain pass (below), NOT the
  // scheduled cron tick — those don't record to cron_runs, so the audit log stays
  // ~1 row per minute instead of one per rapid drain-loop iteration.
  const isChain = req.nextUrl.searchParams.get("chain") === "1";
  const worker = randomUUID();
  after(async () => {
    const startedAt = Date.now();
    const supabase = await createServiceClient();
    // Paused via the Sync Health toggle → don't drain and don't self-chain (the chain
    // call, being another invocation of this route, no-ops too). No run logged → "off".
    if (!(await isCronEnabled(supabase, "process-sync-jobs"))) return;
    try {
      const summary = await drainSyncJobs(supabase, worker);

      // Keep the queue table tidy — finished jobs older than 7 days are history.
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      await supabase
        .from("sync_jobs")
        .delete()
        .in("status", ["done", "failed"])
        .lt("updated_at", cutoff);
      // Keep the cron audit log bounded — 30 days of history is plenty for Sync Health.
      await supabase
        .from("cron_runs")
        .delete()
        .lt("started_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

      console.log(
        `[cron/process-sync-jobs] worker=${worker} processed=${summary.processed} ` +
        `done=${summary.done} failed=${summary.failed} progressed=${summary.progressed}`
      );
      if (!isChain) {
        await logCronRun(supabase, "process-sync-jobs", startedAt, "ok", null, {
          worker, processed: summary.processed, done: summary.done,
          failed: summary.failed, progressed: summary.progressed,
        });
      }

      // Continuous drain: if work is ready NOW, chain another pass immediately so a
      // large backfill finishes in a tight loop instead of crawling between sparse
      // cron ticks. Stops when nothing is ready (queue empty, or all jobs backing
      // off into the future) — the every-minute cron remains the backstop.
      const { count: ready } = await supabase
        .from("sync_jobs")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .lte("run_after", new Date().toISOString());
      // Chain only if this pass actually did work AND ready work remains. The
      // `processed > 0` guard prevents a hot loop if the queue is empty or every
      // job is locked by another worker (claimBatch returned nothing).
      if ((ready ?? 0) > 0 && summary.processed > 0) {
        await fetch(`${req.nextUrl.origin}/api/cron/process-sync-jobs?chain=1`, {
          headers: { authorization: `Bearer ${cronSecret}` },
        }).catch(() => { /* fire-and-forget; cron tick is the backstop */ });
      }
    } catch (err) {
      if (!isChain) {
        await logCronRun(supabase, "process-sync-jobs", startedAt, "failed",
          err instanceof Error ? err.message : String(err), { worker });
      }
      console.error(`[cron/process-sync-jobs] worker=${worker} drain failed:`, err);
    }
  });

  return NextResponse.json({ message: "draining", worker });
}
