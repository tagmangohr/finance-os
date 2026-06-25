import { NextRequest, NextResponse, after } from "next/server";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { enqueueBackfill, drainSyncJobs } from "@/lib/connectors/jobs";
import { isLinkConnector, syncLinkConnector } from "@/lib/connectors/links";
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

  let enqueued = 0, links = 0, skipped = 0;
  const outcomes = await Promise.allSettled(
    (connectors as ConnectorRow[]).map(async (c) => {
      if (isLinkConnector(c.type)) {
        await syncLinkConnector(supabase, c);
        links++;
        return;
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
    message: "Nightly FY reconcile started",
    fy_start: fyStartISO(now),
    connectors_enqueued: enqueued,
    links_synced: links,
    skipped_already_running: skipped,
    failed,
  });
}
