import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncConnectorTransactions } from "@/lib/connectors/sync";
import { enqueueIncremental, isResumable } from "@/lib/connectors/jobs";
import { isLinkConnector, syncLinkConnector } from "@/lib/connectors/links";
import { advanceCheckpoint, computeIncrementalStep } from "@/lib/connectors/checkpoint";
import type { Database } from "@/lib/supabase/types";

type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];

const SYNCABLE_TYPES = ["razorpay", "stripe", "cashfree", "payu", "paytm", "easebuzz", "google_sheets", "excel"];

/**
 * Core logic shared by /api/cron/sync (runs at :00) and
 * /api/cron/sync-half (runs at :30).  Together they achieve a
 * 30-minute effective sync cadence within Vercel Pro's hourly-per-job limit.
 *
 * INCREMENTAL: each connector is advanced by ONE bounded step from its
 * checkpoint (synced_through) — typically just the last few minutes/hours plus a
 * short trailing overlap. Steady-state work is therefore tiny and constant per
 * connector, so this single function scales to dozens of connectors without
 * approaching the Vercel timeout. A connector that has fallen behind catches up
 * over successive runs (one bounded step each). Dedup on external_id keeps the
 * overlap free, and the checkpoint only moves forward → no gaps, no full
 * re-backfill. Deep history is loaded out-of-band via explicit backfill.
 */

export async function runConnectorSync(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServiceClient();

  const { data: connectors, error: connErr } = await supabase
    .from("connectors")
    .select("*")
    .eq("status", "active")
    .in("type", SYNCABLE_TYPES);

  if (connErr) {
    return NextResponse.json({ error: connErr.message }, { status: 500 });
  }
  if (!connectors || connectors.length === 0) {
    return NextResponse.json({ message: "No active connectors", synced: 0 });
  }

  const now = new Date();

  const results = await Promise.allSettled(
    connectors.map(async (connector: ConnectorRow) => {
      // High-volume connectors run on the resumable queue — enqueue a bounded
      // "catch up to now" job (the per-minute worker drains it in cursor chunks)
      // rather than syncing inline here, which could exceed the function budget.
      if (isResumable(connector.type)) {
        await enqueueIncremental(supabase, connector);
        return { inserted: 0, updated: 0, skipped: 0, fetched: 0, warnings: [] as string[], hasMore: false };
      }
      // Link connectors (Google Sheets / online Excel): re-read the public link
      // and mirror it. Small + fast, so run inline.
      if (isLinkConnector(connector.type)) {
        const r = await syncLinkConnector(supabase, connector);
        return { inserted: r.inserted, updated: 0, skipped: 0, fetched: r.fetched, warnings: [] as string[], hasMore: false };
      }
      // Low-volume connectors: one bounded incremental step inline.
      const step = computeIncrementalStep(connector.synced_through, now);
      const result = await syncConnectorTransactions({
        supabase,
        connector,
        fromDate: step.fromDate,
        toDate:   step.toDate,
      });
      await advanceCheckpoint(supabase, connector.id, step.toDate);
      return { ...result, hasMore: step.hasMore };
    })
  );

  const summary = results.map((result, index) => {
    const connector = connectors[index];
    return {
      connector: connector.name,
      type:      connector.type,
      org_id:    connector.org_id,
      id:        connector.id,
      status:    result.status,
      inserted:  result.status === "fulfilled" ? result.value.inserted : 0,
      updated:   result.status === "fulfilled" ? result.value.updated  : 0,
      skipped:   result.status === "fulfilled" ? result.value.skipped  : 0,
      catchingUp: result.status === "fulfilled" ? result.value.hasMore : false,
      warnings:  result.status === "fulfilled" ? result.value.warnings : undefined,
      error:     result.status === "rejected"  ? String(result.reason) : undefined,
    };
  });

  const totalInserted = summary.reduce((s, r) => s + r.inserted, 0);
  const totalUpdated  = summary.reduce((s, r) => s + r.updated,  0);

  // ── Alert on failure, self-heal on recovery ──────────────────────────────
  await Promise.allSettled(
    summary.map(async (r) => {
      if (r.status === "rejected") {
        // Insert a critical alert visible on the War Room Active Alerts card.
        // data.connector_id lets us find and clear it when sync recovers.
        await supabase.from("intelligence_alerts").insert({
          org_id:   r.org_id,
          type:     "anomaly",
          severity: "critical",
          title:    `${r.connector} sync failed`,
          message:  r.error ?? "Unknown error during connector sync",
          is_read:  false,
          data:     { connector_id: r.id, subtype: "sync_failure" },
        });
      } else {
        // Sync recovered — delete any unread sync_failure alerts for this connector
        // so the War Room clears automatically without manual intervention.
        await supabase
          .from("intelligence_alerts")
          .delete()
          .eq("org_id", r.org_id)
          .eq("type", "anomaly")
          .eq("is_read", false)
          .filter("data->>subtype",       "eq", "sync_failure")
          .filter("data->>connector_id",  "eq", r.id);
      }
    })
  );
  // ─────────────────────────────────────────────────────────────────────────

  const failCount = summary.filter((r) => r.status === "rejected").length;
  console.log(
    `[cron/sync] ${new Date().toISOString()} — ${connectors.length} connectors, ` +
    `${totalInserted} new, ${totalUpdated} refreshed, ${failCount} failed`
  );

  return NextResponse.json({
    message: "OK",
    synced:  totalInserted,
    updated: totalUpdated,
    failed:  failCount,
    detail:  summary,
  });
}
