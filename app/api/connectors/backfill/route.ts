import { NextRequest, NextResponse, after } from "next/server";
import { isAuthFailure, requireConnectorAccess } from "@/lib/api/auth";
import { parseSyncDateRange } from "@/lib/api/validation";
import { enqueueBackfill, enqueueIncremental, enqueueLinkSheetSync } from "@/lib/connectors/jobs";
import { isLinkConnector } from "@/lib/connectors/links";
import { createServiceClient } from "@/lib/supabase/server";

// Link connectors parse + STAGE the whole sheet in the background (after()), which
// can take a while for 100k+ rows — the background phase runs within this budget.
export const maxDuration = 300;

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

  const { connector_id: connectorId, org_id: orgId, from_date, to_date, incremental } = body as
    typeof body & { incremental?: boolean };
  if (!connectorId || !orgId) {
    return NextResponse.json({ error: "connector_id and org_id are required" }, { status: 400 });
  }

  const auth = await requireConnectorAccess(connectorId, { orgId });
  if (isAuthFailure(auth)) return auth.error;

  // ── Link connectors (Google Sheet / Excel): parse+stage in the background, then
  //    a resumable job applies the staged rows server-side in chunks (scales to
  //    100k+). Dates are irrelevant (the whole sheet is the source of truth). ──
  if (isLinkConnector(auth.connector.type)) {
    // Parse+stage the sheet then enqueue the resumable apply job — in the background
    // (300s budget). Returns immediately; the client polls the queue for progress.
    // The job appears within ~200ms, well before the poll's first ~2.5s check.
    const cronSecret = process.env.CRON_SECRET;
    const workerUrl = `${req.nextUrl.origin}/api/cron/process-sync-jobs`;
    after(async () => {
      const svc = await createServiceClient();
      try {
        // Full connector row (config.sheet_url / tabs) — auth.connector is a partial.
        const { data: fullConn, error: cErr } = await svc
          .from("connectors").select("*").eq("id", connectorId).eq("org_id", auth.connector.org_id).single();
        if (cErr || !fullConn) throw new Error(cErr?.message ?? "Connector not found");
        await enqueueLinkSheetSync(svc, fullConn);
        if (cronSecret) { try { await fetch(workerUrl, { headers: { authorization: `Bearer ${cronSecret}` } }); } catch { /* cron will pick it up */ } }
      } catch (e) {
        console.error("[backfill] sheet enqueue failed:", e instanceof Error ? e.message : e);
      }
    });
    return NextResponse.json({ enqueued: 1 });
  }

  const range = parseSyncDateRange(from_date, to_date);
  if ("error" in range) return range.error;

  try {
    // incremental=true → "catch up to now" (one resumable job, advances the
    // checkpoint). Otherwise an explicit date-range backfill.
    const enqueued = incremental
      ? (await enqueueIncremental(auth.supabase, auth.connector)).enqueued ? 1 : 0
      : await enqueueBackfill(auth.supabase, auth.connector, range.fromDate, range.toDate);

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
  } catch (err) {
    // Surface the real reason instead of a bare 500 so the UI can show it.
    const message = err instanceof Error ? err.message : "Failed to queue backfill";
    console.error(`[backfill] connector=${connectorId} org=${orgId} failed:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
