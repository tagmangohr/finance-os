import { NextRequest, NextResponse, after } from "next/server";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { logCronRun } from "@/lib/ops/cron-runs";
import { isCronEnabled } from "@/lib/ops/cron-settings";
import { detectCashfreeSubDoubleCounts } from "@/lib/ops/sub-integrity";
import { categorizeSource } from "@/lib/finance/transaction-status";
import { enqueueIncremental, drainSyncJobs, enqueueLinkSheetSync } from "@/lib/connectors/jobs";
import { syncStripeEventsDelta, reconcileStripeFees } from "@/lib/connectors/stripe-events";
import { isLinkConnector } from "@/lib/connectors/links";
import { reconcileFxRates } from "@/lib/fx/rates";
import type { Database } from "@/lib/supabase/types";

// 300s: parsing + staging large link-connector sheets (100k+ rows) runs here.
export const maxDuration = 300;

type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];

/** Connectors reconciled by the nightly job. */
const SYNCABLE_TYPES = ["razorpay", "stripe", "cashfree", "payu", "paytm", "easebuzz", "mercury", "google_sheets", "excel"];

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
  const startedAt = Date.now();

  // Paused via the Sync Health toggle → no-op (don't log a run; the page shows it "off").
  if (!(await isCronEnabled(supabase, "nightly-sync"))) {
    return NextResponse.json({ ok: true, skipped: "disabled" });
  }

  const { data: connectors, error } = await supabase
    .from("connectors")
    .select("*")
    .eq("status", "active")
    .in("type", SYNCABLE_TYPES);
  if (error) {
    await logCronRun(supabase, "nightly-sync", startedAt, "failed", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!connectors || connectors.length === 0) {
    await logCronRun(supabase, "nightly-sync", startedAt, "ok", null, { enqueued: 0 });
    return NextResponse.json({ message: "No active connectors", enqueued: 0 });
  }

  const now = new Date();

  // Leave headroom under the 60s function budget for the inline Stripe events delta.
  const eventsDeadline = Date.now() + 40_000;

  let enqueued = 0, links = 0, skipped = 0, eventsDelta = 0, feesFilled = 0;
  const outcomes = await Promise.allSettled(
    (connectors as ConnectorRow[]).map(async (c) => {
      if (isLinkConnector(c.type)) {
        // Parse+stage the sheet, then let the background worker apply it in chunks
        // (scales to 100k+). NOT a synchronous merge — that would block the cron and
        // time out on a large sheet. The per-org rebuild inside the job refreshes the
        // cache, so no invalidateOrg needed here.
        await enqueueLinkSheetSync(supabase, c);
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
      // Skip if an on-demand backfill (advance_checkpoint = false) is already
      // draining for this connector — so nightly runs never pile on top of it.
      const { count } = await supabase
        .from("sync_jobs")
        .select("id", { count: "exact", head: true })
        .eq("connector_id", c.id)
        .eq("advance_checkpoint", false)
        .in("status", ["pending", "running"]);
      if ((count ?? 0) > 0) { skipped++; return; }

      // Incremental catch-up from the connector's checkpoint (synced_through − 3d
      // overlap → now), NOT a full-FY re-scan. Advances synced_through on success.
      // The old full-FY enqueueBackfill re-scanned Apr→now every night; for Cashfree
      // (a single non-resumable recon job) that grew too large to finish, so it kept
      // timing out and the checkpoint never advanced — freezing the data.
      const { enqueued: didEnqueue } = await enqueueIncremental(supabase, c);
      if (didEnqueue) enqueued++;
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

  // Cashfree connectors are still needed here for the sub-dupe watchdog (below). The
  // heavy per-connector reconciliation (poll/fees/subs/invoices/categorize) moved to
  // /api/cron/reconcile, so subApi/bank connector lists are computed there now.
  const cashfreeConnectors = (connectors as ConnectorRow[]).filter((c) => c.type === "cashfree");
  const worker = randomUUID();
  after(async () => {
    const sb = await createServiceClient();

    // ── Integrity watchdogs FIRST ─────────────────────────────────────────────
    // Read-only checks that run BEFORE the heavy reconciliation below, so they always
    // complete and record to cron_runs even if a later phase exhausts the 300s budget.
    // (sub-dupe-watch previously sat at the very tail and, when the tail was starved,
    // never actually ran — its "no runs" on Sync Health is what surfaced this.)

    // Payment-pending watchdog. After the persistTransactions revenue guard, NO new
    // non-terminal payment CHARGE should ever be stored. Count any that remain, per org,
    // so a regression (some path bypassing the guard) is caught and surfaced on Sync
    // Health instead of silently re-accumulating. Payment charges only — pending
    // disputes ("open") and settlements ("in transit") are legitimate and excluded.
    {
      const wStart = Date.now();
      try {
        const orgIds = Array.from(new Set((connectors as ConnectorRow[]).map((c) => c.org_id)));
        const byOrg: Record<string, number> = {};
        for (const oid of orgIds) {
          const { data: pend } = await sb.from("transactions").select("source")
            .eq("org_id", oid).eq("ledger", "payments").eq("status", "pending").limit(5000);
          const n = (pend ?? []).filter((r) => categorizeSource(r.source as string) === "payment").length;
          if (n > 0) byOrg[oid] = n;
        }
        const total = Object.values(byOrg).reduce((a, b) => a + b, 0);
        await logCronRun(sb, "payment-pending-watch", wStart, "ok", null, { total, byOrg });
        if (total) console.warn(`[cron/nightly-sync] ⚠ ${total} stranded payment-charge 'pending' row(s) across ${Object.keys(byOrg).length} org(s)`);
      } catch (e) {
        await logCronRun(sb, "payment-pending-watch", wStart, "failed", e instanceof Error ? e.message : String(e));
      }
    }

    // Cashfree recurring-charge double-count watchdog (last 30 days). Read-only, non-fatal.
    // The dedup invariant (cf_pay_<cf_txn_id> collapses webhook/poller/recon onto one row)
    // is validated at 0 across full history; this catches a future regression. Scanned
    // PER-ORG (only orgs with a Cashfree connector) so each query hits an org_id-leading
    // index. Recorded to cron_runs; the Sync Health page surfaces any finding as a red flag.
    {
      const wStart = Date.now();
      try {
        const cfOrgIds = Array.from(new Set(cashfreeConnectors.map((c) => c.org_id)));
        const byOrg: Record<string, number> = {};
        const sample: Awaited<ReturnType<typeof detectCashfreeSubDoubleCounts>>["groups"] = [];
        let scanned = 0;
        for (const oid of cfOrgIds) {
          const dupes = await detectCashfreeSubDoubleCounts(sb, { orgId: oid, sinceDays: 30 });
          scanned += dupes.scanned;
          if (dupes.groups.length) {
            byOrg[oid] = dupes.groups.length;
            for (const g of dupes.groups.slice(0, 5)) if (sample.length < 5) sample.push(g);
          }
        }
        const offending = Object.values(byOrg).reduce((a, b) => a + b, 0);
        await logCronRun(sb, "sub-dupe-watch", wStart, "ok", null, { scanned, offending, byOrg, sample });
        if (offending) console.error(`[cron/nightly-sync] ⚠ ${offending} possible subscription double-count group(s) in last 30d`);
      } catch (e) {
        await logCronRun(sb, "sub-dupe-watch", wStart, "failed", e instanceof Error ? e.message : String(e));
        console.error("[cron/nightly-sync] sub-dupe watch failed:", e);
      }
    }

    // ── Drain kick ────────────────────────────────────────────────────────────
    // Start applying the night's enqueued backfills immediately instead of waiting for
    // the next per-minute worker tick. Bounded; safe to overlap (SKIP LOCKED).
    try {
      await drainSyncJobs(sb, worker);
    } catch (e) {
      console.error("[cron/nightly-sync] drain failed:", e);
    }

    // The heavy per-connector reconciliation (Cashfree poll + fee recon, Stripe/Razorpay
    // subscription + invoice sync, subscription-charge tagging, bank categorization) has
    // moved to its OWN cron — /api/cron/reconcile (02:00 IST) — so it can never be starved
    // by this after()'s budget the way it silently was before. This after() now does only
    // the cheap, always-completing work: the integrity watchdogs (above) + the drain kick.
  });

  await logCronRun(supabase, "nightly-sync", startedAt, "ok", null, {
    connectors_enqueued: enqueued, links_synced: links, stripe_events_delta: eventsDelta,
    stripe_fees_filled: feesFilled, fx_reconciled: fxReconciled, skipped_already_running: skipped,
  });
  return NextResponse.json({
    message: "Nightly reconcile started",
    stripe_events_delta: eventsDelta,
    stripe_fees_filled: feesFilled,
    fx_reconciled: fxReconciled,
    connectors_enqueued: enqueued,
    links_synced: links,
    skipped_already_running: skipped,
    failed,
  });
}
