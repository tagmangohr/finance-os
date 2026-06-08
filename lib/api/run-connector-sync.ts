import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncConnectorTransactions } from "@/lib/connectors/sync";
import type { Database } from "@/lib/supabase/types";

type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];

const SYNCABLE_TYPES = ["razorpay", "stripe", "cashfree", "payu", "paytm", "easebuzz"];

/**
 * Core logic shared by /api/cron/sync (runs at :00) and
 * /api/cron/sync-half (runs at :30).  Together they achieve a
 * 30-minute effective sync cadence within Vercel Pro's hourly-per-job limit.
 *
 * Syncs the last 30 days on every run so late-arriving transactions,
 * status updates (e.g. captured → refunded), and any missed windows are
 * always reconciled. Upserts are idempotent on external_id so re-fetching
 * already-stored rows is safe and cheap.
 */
const LOOKBACK_DAYS = 30;

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

  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const results = await Promise.allSettled(
    connectors.map((connector: ConnectorRow) =>
      syncConnectorTransactions({ supabase, connector, fromDate, toDate })
    )
  );

  const summary = results.map((result, index) => {
    const connector = connectors[index];
    return {
      connector: connector.name,
      type:      connector.type,
      status:    result.status,
      inserted:  result.status === "fulfilled" ? result.value.inserted : 0,
      updated:   result.status === "fulfilled" ? result.value.updated  : 0,
      skipped:   result.status === "fulfilled" ? result.value.skipped  : 0,
      warnings:  result.status === "fulfilled" ? result.value.warnings : undefined,
      error:     result.status === "rejected"  ? String(result.reason) : undefined,
    };
  });

  const totalInserted = summary.reduce((s, r) => s + r.inserted, 0);
  const totalUpdated  = summary.reduce((s, r) => s + r.updated,  0);

  console.log(
    `[cron/sync] ${new Date().toISOString()} — ${connectors.length} connectors, ` +
    `${totalInserted} new, ${totalUpdated} refreshed`
  );

  return NextResponse.json({
    message: "OK",
    synced:  totalInserted,
    updated: totalUpdated,
    detail:  summary,
  });
}
