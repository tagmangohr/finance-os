import { NextRequest, NextResponse, after } from "next/server";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { enqueueBackfill, drainSyncJobs } from "@/lib/connectors/jobs";
import { syncStripeEventsDelta, reconcileStripeFees } from "@/lib/connectors/stripe-events";
import { isLinkConnector, syncLinkConnector } from "@/lib/connectors/links";
import { reconcileFxRates } from "@/lib/fx/rates";
import { fyStartISO } from "@/lib/utils";
import type { Database } from "@/lib/supabase/types";

export const maxDuration = 60;

type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];

/** Connectors reconciled by the nightly job. */
const SYNCABLE_TYPES = ["razorpay", "stripe", "cashfree", "payu", "paytm", "easebuzz", "google_sheets", "excel"];

/**
 * GET /api/cron/nightly-sync — runs at 00:30 IST (19:00 UTC, cron "0 19 * * *").
 *
 * The single scheduled sync: a DEEP daily reconcile that re-scans the whole
 * financial year (1 Apr → now) for every active connector, so refunds, disputes
 * and status changes on ANY order in the FY are caught — not only recent ones.
 * Heavy but safe: dedup on external_id makes it idempotent, unchanged rows are
 * skipped, and it runs overnight when traffic is low.
 *
 * Gateways enqueue a windowed backfill onto the resumable queue (the per-minute
 * worker drains it in bounded cursor chunks, so any volume / years of data stay
 * within the function budget). Link connectors (Sheets/Excel) are small, so they
 * re-read inline. We DON'T stack: a connector still draining a prior backfill is
 * skipped this run rather than piling on duplicate windows.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceClient();
  const { data: connectors, error } = await supabase
    .from("connectors")
    .select("*")
    .eq("status", "active")
    .in("type", SYNCABLE_TYPES);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!connectors || connectors.length === 0) {
    return NextResponse.json({ message: "No active connectors", enqueued: 0 });
  }

  const now = new Date();
  // FY start = 1 Apr of the current Indian FY, at IST midnight (fyStartISO is
  // IST-correct). enqueueBackfill slices [fyStart, now] into resumable windows.
  const fyStart = new Date(`${fyStartISO(now)}T00:00:00+05:30`);

  // Leave headroom under the 60s function budget for the inline Stripe events delta.
  const eventsDeadline = Date.now() + 40_000;

  let enqueued = 0, links = 0, skipped = 0, eventsDelta = 0, feesFilled = 0;
  const outcomes = await Promise.allSettled(
    (connectors as ConnectorRow[]).map(async (c) => {
      if (isLinkConnector(c.type)) {
        await syncLinkConnector(supabase, c);
        links++;
        return;
      }
      // Stripe: pull only what changed since the checkpoint via the events feed
      // (seconds, flat-cost) instead of re-scanning the whole FY. Falls back to the
      // full backfill below only when a delta can't run safely (no checkpoint yet,
      // or checkpoint older than Stripe's 30-day events window).
      if (c.type === "stripe") {
        try {
          const res = await syncStripeEventsDelta(supabase, c, eventsDeadline);
          if (!res.needsBackfill) {
            // Fees never arrive via the webhook or events feed (they live on the
            // balance transaction), so reconcile the recent window from the
            // balance-transactions feed. Fill-only + idempotent; non-fatal.
            try {
              const sinceSec = Math.floor((Date.now() - 7 * 86_400_000) / 1000);
              const feeRes = await reconcileStripeFees(supabase, c, { sinceSec, deadlineMs: Date.now() + 15_000 });
              feesFilled += feeRes.updated;
            } catch (e) {
              console.error(`[cron/nightly-sync] stripe fee reconcile failed (${c.id}):`, e);
            }
            eventsDelta++;
            return;
          }
        } catch (e) {
          console.error(`[cron/nightly-sync] stripe events delta failed (${c.id}), falling back to backfill:`, e);
        }
      }
      // Skip if a backfill (advance_checkpoint = false) is already draining for
      // this connector — from last night or a manual sync — so nightly runs never
      // pile duplicate windows on top of in-flight ones.
      const { count } = await supabase
        .from("sync_jobs")
        .select("id", { count: "exact", head: true })
        .eq("connector_id", c.id)
        .eq("advance_checkpoint", false)
        .in("status", ["pending", "running"]);
      if ((count ?? 0) > 0) { skipped++; return; }

      const windows = await enqueueBackfill(supabase, c, fyStart, now);
      if (windows > 0) enqueued++;
    })
  );
  const failed = outcomes.filter((o) => o.status === "rejected").length;

  // Reconcile FX over a trailing window. The fx_rate frozen at sync time is only an
  // approximation for the current day (ECB publishes that day's rate at ~16:00 CET,
  // after many same-day transactions have already synced against the prior day's
  // rate). Re-deriving the authoritative nearest-prior rate now collapses each day
  // to a single rate once its ECB rate is published. Global (rates aren't org-
  // specific), idempotent, and non-fatal so it never blocks the sync.
  let fxReconciled = 0;
  try {
    const istDate = (offsetDays: number) => {
      const d = new Date(now.getTime() - offsetDays * 86_400_000);
      return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
    };
    const fx = await reconcileFxRates(supabase, { fromDate: istDate(10), toDate: istDate(0) });
    fxReconciled = fx.updated;
  } catch (e) {
    console.error("[cron/nightly-sync] fx reconcile failed:", e);
  }

  // Kick the worker so draining starts immediately instead of waiting for the
  // next per-minute process-sync-jobs tick.
  const worker = randomUUID();
  after(async () => {
    try {
      await drainSyncJobs(await createServiceClient(), worker);
    } catch (e) {
      console.error("[cron/nightly-sync] drain failed:", e);
    }
  });

  return NextResponse.json({
    message: "Nightly reconcile started",
    fy_start: fyStartISO(now),
    stripe_events_delta: eventsDelta,
    stripe_fees_filled: feesFilled,
    fx_reconciled: fxReconciled,
    connectors_enqueued: enqueued,
    links_synced: links,
    skipped_already_running: skipped,
    failed,
  });
}
