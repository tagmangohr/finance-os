import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncConnectorTransactions } from "@/lib/connectors/sync";
import type { Database } from "@/lib/supabase/types";

type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];

const SYNCABLE_TYPES = ["razorpay", "stripe", "cashfree", "payu", "paytm", "easebuzz"];

/**
 * GET /api/cron/sync
 *
 * Syncs the last 2 hours of data across all orgs with active connectors.
 * Requires CRON_SECRET via Authorization: Bearer <secret>.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
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
  const fromDate = new Date(toDate.getTime() - 2 * 60 * 60 * 1000);

  const results = await Promise.allSettled(
    connectors.map((connector: ConnectorRow) =>
      syncConnectorTransactions({ supabase, connector, fromDate, toDate })
    )
  );

  const summary = results.map((result, index) => {
    const connector = connectors[index];
    return {
      connector: connector.name,
      type: connector.type,
      status: result.status,
      inserted: result.status === "fulfilled" ? result.value.inserted : 0,
      skipped: result.status === "fulfilled" ? result.value.skipped : 0,
      warnings: result.status === "fulfilled" ? result.value.warnings : undefined,
      error: result.status === "rejected" ? String(result.reason) : undefined,
    };
  });

  const totalInserted = summary.reduce((sum, result) => sum + result.inserted, 0);

  console.log(
    `[cron/sync] ${new Date().toISOString()} - ${connectors.length} connectors, ${totalInserted} new txns`
  );

  return NextResponse.json({ message: "OK", synced: totalInserted, detail: summary });
}
