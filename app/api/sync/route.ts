import { NextRequest, NextResponse, after } from "next/server";
import { isAuthFailure, requireOrgAccess } from "@/lib/api/auth";
import { parseSyncDateRange } from "@/lib/api/validation";
import { enqueueBackfill } from "@/lib/connectors/jobs";
import { isLinkConnector, syncLinkConnector } from "@/lib/connectors/links";
import type { Database } from "@/lib/supabase/types";

type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];

export const maxDuration = 30;

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

  // Background: run the small link syncs + kick the worker so jobs start now.
  const cronSecret = process.env.CRON_SECRET;
  const origin = req.nextUrl.origin;
  after(async () => {
    for (const c of linkConnectors) {
      try { await syncLinkConnector(auth.supabase, c); } catch { /* surfaced via connector status */ }
    }
    if (enqueued > 0 && cronSecret) {
      try { await fetch(`${origin}/api/cron/process-sync-jobs`, { headers: { authorization: `Bearer ${cronSecret}` } }); } catch { /* cron drains anyway */ }
    }
  });

  return NextResponse.json({
    enqueued,
    connectors: connectors.length,
    link: linkConnectors.length,
  });
}
