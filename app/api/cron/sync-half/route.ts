import { type NextRequest } from "next/server";
import { runConnectorSync } from "@/lib/api/run-connector-sync";

/**
 * GET /api/cron/sync-half — runs at :30 every hour (Vercel cron: 30 * * * *)
 *
 * Paired with /api/cron/sync (runs at :00), these two jobs achieve a
 * 30-minute effective sync frequency within Vercel Pro's hourly-per-job limit.
 * Both use a 2-hour lookback window so no transactions slip through.
 */
export async function GET(req: NextRequest) {
  return runConnectorSync(req);
}
