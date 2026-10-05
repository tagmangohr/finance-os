import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { logCronRun } from "@/lib/ops/cron-runs";
import { isCronEnabled } from "@/lib/ops/cron-settings";
import { enqueueReconcile } from "@/lib/connectors/jobs";

export const runtime = "nodejs";
// Thin ENQUEUER only — it just creates the bounded reconcile jobs and returns in ~1s.
// The heavy per-connector work runs on the per-minute worker (process-sync-jobs), each
// job time-boxed and resumable, so reconcile can never exhaust a function budget again.
export const maxDuration = 60;

/**
 * GET /api/cron/reconcile — nightly reconciliation, now QUEUE-BASED.
 *
 * HISTORY / WHY THIS SHAPE: this used to run every phase (Cashfree subscription poll +
 * settlement-fee + dispute-fee recon, Stripe/Razorpay subscription + invoice sync,
 * charge tagging, bank categorization) for every connector SYNCHRONOUSLY inside one
 * 300s function. With an unbounded, flaky Cashfree recon fetch (no per-request timeout)
 * and cumulative per-connector deadlines, the pass regularly exceeded the budget and was
 * killed BEFORE recordCronRun could write a result — leaving an orphaned "running" row
 * (Sync Health's "did not finish"), and in fact NEVER completing a single night.
 *
 * Now it enqueues bounded, resumable queue jobs (see enqueueReconcile) that the
 * per-minute worker drains in ≤CHUNK_FETCH_MS chunks. The enqueuer is fast and always
 * records a result; the recon fetch is now per-request-timed-out and deadline-bounded.
 *
 * Runs at 02:00 IST (20:30 UTC), ~90 min after nightly-sync. Idempotent / fill-only, so
 * overlaps and retries are safe.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  after(async () => {
    const supabase = await createServiceClient();
    // Paused via the Sync Health toggle → no-op (no run logged; the page shows it "off").
    if (!(await isCronEnabled(supabase, "reconcile"))) return;

    const startedAt = Date.now();
    try {
      const { enqueued, skipped } = await enqueueReconcile(supabase);
      console.log(`[cron/reconcile] enqueued=${enqueued} skipped=${skipped}`);
      await logCronRun(supabase, "reconcile", startedAt, "ok", null, { enqueued, skipped });
      // Kick the worker so the jobs start draining now instead of waiting for the next
      // minute tick. Best-effort — the every-minute cron is the backstop either way.
      try {
        await fetch(`${req.nextUrl.origin}/api/cron/process-sync-jobs?chain=1`, {
          headers: { authorization: `Bearer ${cronSecret}` },
        });
      } catch { /* worker cron will pick the jobs up regardless */ }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logCronRun(supabase, "reconcile", startedAt, "failed", msg);
      console.error("[cron/reconcile] enqueue failed:", err);
    }
  });

  return NextResponse.json({ ok: true });
}
