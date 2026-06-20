import { NextRequest, NextResponse, after } from "next/server";
import { isAuthFailure, requireConnectorAccess } from "@/lib/api/auth";
import { parseSyncDateRange } from "@/lib/api/validation";
import { enqueueBackfill } from "@/lib/connectors/jobs";

export const maxDuration = 30;

/**
 * POST /api/connectors/backfill
 * Enqueue a date-range backfill as bounded background jobs and return immediately.
 * The per-minute worker cron drains the queue; we also kick it now so processing
 * starts without waiting for the next tick.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { connector_id?: string; org_id?: string; from_date?: string; to_date?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { connector_id: connectorId, org_id: orgId, from_date, to_date } = body;
  if (!connectorId || !orgId) {
    return NextResponse.json({ error: "connector_id and org_id are required" }, { status: 400 });
  }

  const range = parseSyncDateRange(from_date, to_date);
  if ("error" in range) return range.error;

  const auth = await requireConnectorAccess(connectorId, { orgId });
  if (isAuthFailure(auth)) return auth.error;

  const enqueued = await enqueueBackfill(
    auth.supabase,
    auth.connector,
    range.fromDate,
    range.toDate
  );

  // Kick the worker after the response so processing starts promptly.
  const cronSecret = process.env.CRON_SECRET;
  if (enqueued > 0 && cronSecret) {
    const workerUrl = `${req.nextUrl.origin}/api/cron/process-sync-jobs`;
    after(async () => {
      try {
        await fetch(workerUrl, { headers: { authorization: `Bearer ${cronSecret}` } });
      } catch {
        // Best-effort kick; the cron will drain the queue regardless.
      }
    });
  }

  return NextResponse.json({ enqueued });
}
