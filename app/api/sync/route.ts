import { NextRequest, NextResponse, after } from "next/server";
import { isAuthFailure, requireOrgAccess } from "@/lib/api/auth";
import { parseSyncDateRange } from "@/lib/api/validation";
import { enqueueBackfill, enqueueLinkSheetSync } from "@/lib/connectors/jobs";
import { isLinkConnector } from "@/lib/connectors/links";
import { createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];

// Sheets/Excel parse+stage the whole workbook in the background (after()) and then
// enqueue a resumable job that applies the staged rows in bounded chunks — they are
// NO LONGER merged synchronously here (that non-resumable O(n) path 504'd on large
// sheets). 300s gives the background parse+stage ample headroom; gateway fallbacks
// finish fast regardless.
export const maxDuration = 300;

const GATEWAY_TYPES = ["razorpay", "stripe", "cashfree", "payu", "paytm", "easebuzz"];
const SYNCABLE_TYPES = [...GATEWAY_TYPES, "google_sheets", "excel"];

/**
 * POST /api/sync  { org_id, from_date?, to_date? }
 *
 * Global "sync everything" — NON-BLOCKING. Enqueues a background backfill for each
 * gateway connector (drained by the resumable worker) and kicks link connectors
 * (Sheets/Excel) in the background. Returns immediately so the UI stays usable;
 * progress shows as the live bars on Connectors. Never syncs inline (which blocked
 * the screen and timed out on high-volume Stripe).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { org_id?: string; from_date?: string; to_date?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { org_id: orgId, from_date, to_date } = body;
  if (!orgId) return NextResponse.json({ error: "org_id is required" }, { status: 400 });

  const auth = await requireOrgAccess(orgId);
  if (isAuthFailure(auth)) return auth.error;

  const range = parseSyncDateRange(from_date, to_date);
  if ("error" in range) return range.error;

  const { data: connectors, error: connErr } = await auth.supabase
    .from("connectors")
    .select("*")
    .eq("org_id", auth.org.id)
    .eq("status", "active")
    .in("type", SYNCABLE_TYPES);

  if (connErr) {
    return NextResponse.json({ error: "Failed to fetch connectors", details: connErr.message }, { status: 500 });
  }
  if (!connectors || connectors.length === 0) {
    return NextResponse.json({ enqueued: 0, connectors: 0, link: 0 });
  }

  let enqueued = 0;
  const linkConnectors: ConnectorRow[] = [];
  for (const c of connectors as ConnectorRow[]) {
    if (isLinkConnector(c.type)) linkConnectors.push(c);
    else enqueued += await enqueueBackfill(auth.supabase, c, range.fromDate, range.toDate);
  }

  // Background: enqueue the sheet syncs via the resumable staging path + kick the
  // worker so jobs start now.
  const cronSecret = process.env.CRON_SECRET;
  const origin = req.nextUrl.origin;
  after(async () => {
    // Sheets/Excel route through the SAME resumable staging path as the per-connector
    // "Sync" button (parse+stage → delete → apply in bounded, lock-safe chunks, with
    // rollups maintained incrementally). The previous direct mergeConnectorTransactions
    // path here was a NON-resumable 300s O(n) merge that fired per-row triggers with no
    // suppression and 504'd on large sheets — it must never run for the global sync.
    // Categorization of the (re-)inserted bank rows is handled by the worker/nightly
    // path, exactly as it is for the per-connector Sync button (parity).
    if (linkConnectors.length > 0) {
      try {
        const svc = await createServiceClient();
        for (const c of linkConnectors) {
          try {
            await enqueueLinkSheetSync(svc, c);
          } catch (e) {
            console.error("[sync] sheet enqueue failed (non-fatal):", e instanceof Error ? e.message : e);
          }
        }
      } catch (e) {
        console.error("[sync] sheet staging setup failed (non-fatal):", e instanceof Error ? e.message : e);
      }
    }
    if ((enqueued > 0 || linkConnectors.length > 0) && cronSecret) {
      try { await fetch(`${origin}/api/cron/process-sync-jobs`, { headers: { authorization: `Bearer ${cronSecret}` } }); } catch { /* cron drains anyway */ }
    }
  });

  return NextResponse.json({
    enqueued,
    connectors: connectors.length,
    link: linkConnectors.length,
  });
}
