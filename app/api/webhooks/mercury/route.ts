import { NextRequest, NextResponse, after } from "next/server";
import crypto from "crypto";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { decryptConfigSecrets } from "@/lib/crypto/secrets";
import { enqueueIncremental, drainSyncJobs } from "@/lib/connectors/jobs";
import { captureEvent } from "@/lib/events/capture";
import { categorizeBankTransactions } from "@/lib/expenses/categorize";
import { refreshMercuryBalances } from "@/lib/expenses/mercury-balances";
import type { Database } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SupabaseLike = Awaited<ReturnType<typeof createServiceClient>>;
type WebhookEventInsert = Database["public"]["Tables"]["webhook_events"]["Insert"];

async function logWebhook(
  supabase: SupabaseLike,
  row: Partial<WebhookEventInsert> & { outcome: WebhookEventInsert["outcome"]; signature_ok: boolean }
): Promise<void> {
  const full: WebhookEventInsert = {
    provider: "mercury",
    event_type: null, connector_id: null, org_id: null, external_id: null,
    order_id: null, amount: null, status: null, error: null, payload: null,
    ...row,
  };
  try { await supabase.from("webhook_events").insert(full); }
  catch (e) { console.error("[mercury webhook] event log insert failed (non-fatal):", e); }
}

const peekType = (raw: string): string | null => {
  try {
    const o = JSON.parse(raw) as { type?: string; resourceType?: string; operationType?: string };
    return o.type ?? (o.resourceType ? `${o.resourceType}.${o.operationType ?? "event"}` : null);
  } catch { return null; }
};

/**
 * POST /api/webhooks/mercury  (optionally ?c=<connectorId> when >1 Mercury connector)
 *
 * Real-time Mercury ingestion. Mercury signs each request:
 *   Mercury-Signature: t=<unix_seconds>,v1=<hex HMAC-SHA256(secretKey, "<t>.<rawBody>")>
 * We verify against the connector's stored `webhook_secret`.
 *
 * The event body is a thin envelope (resourceId/mergePatch/changedPaths) that
 * doesn't reliably carry the account or its kind, so we treat the webhook as a
 * TRIGGER: a transaction event enqueues an incremental sync (authoritative data +
 * account kind) then auto-categorizes; a *.balance.updated event refreshes stored
 * account balances. Everything runs in after() so we ACK fast. Idempotent.
 *
 * Until a webhook_secret is saved on the connector we ACK 200 without processing
 * (so Mercury's "Verify endpoint" test passes during setup) and log it.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createServiceClient();
  const rawBody = await req.text();

  // Match the Mercury connector (sole active one, or the ?c= override).
  const cParam = req.nextUrl.searchParams.get("c");
  let cq = supabase.from("connectors").select("id, org_id, type, config").eq("type", "mercury").eq("status", "active");
  if (cParam) cq = cq.eq("id", cParam);
  const { data: conns } = await cq;
  const list = conns ?? [];
  const connector = (cParam ? list[0] : list.length === 1 ? list[0] : null) as
    | { id: string; org_id: string; config: Record<string, unknown> | null } | null;

  if (!connector) {
    await logWebhook(supabase, { outcome: "unmatched", signature_ok: false, event_type: peekType(rawBody) });
    return NextResponse.json({ received: true, unmatched: true }, { status: 200 });
  }

  const secret = decryptConfigSecrets((connector.config ?? {}) as Record<string, string>).webhook_secret;
  if (!secret) {
    // Setup not finished — ACK so the "Verify endpoint" test succeeds; don't process.
    await logWebhook(supabase, { outcome: "ignored", signature_ok: false, event_type: peekType(rawBody), connector_id: connector.id, org_id: connector.org_id, error: "webhook_secret not configured" });
    return NextResponse.json({ received: true, note: "secret not configured" }, { status: 200 });
  }

  // ── Verify signature: header "t=<sec>,v1=<hex>" over "<t>.<rawBody>" ──
  const header = req.headers.get("mercury-signature") ?? "";
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=").map((s) => s.trim()) as [string, string]));
  const t = parts["t"];
  const v1 = parts["v1"] ?? "";
  if (!t || !v1) {
    await logWebhook(supabase, { outcome: "signature_failed", signature_ok: false, event_type: peekType(rawBody), connector_id: connector.id, org_id: connector.org_id, error: "missing t/v1" });
    return NextResponse.json({ error: "Invalid signature header" }, { status: 401 });
  }
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(v1, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    await logWebhook(supabase, { outcome: "signature_failed", signature_ok: false, event_type: peekType(rawBody), connector_id: connector.id, org_id: connector.org_id });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  // Replay guard: reject signatures older than 15 minutes.
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(t));
  if (Number.isFinite(skew) && skew > 900) {
    await logWebhook(supabase, { outcome: "signature_failed", signature_ok: true, event_type: peekType(rawBody), connector_id: connector.id, org_id: connector.org_id, error: `stale timestamp (${skew}s)` });
    return NextResponse.json({ error: "Stale signature" }, { status: 401 });
  }

  let event: { type?: string; resourceType?: string; operationType?: string; resourceId?: string };
  try { event = JSON.parse(rawBody); }
  catch { await logWebhook(supabase, { outcome: "bad_json", signature_ok: true, connector_id: connector.id, org_id: connector.org_id }); return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const type = event.type ?? (event.resourceType ? `${event.resourceType}.${event.operationType ?? "event"}` : "");
  const isTransaction = event.resourceType === "transaction" || type.startsWith("transaction");
  const isBalance = /balance/i.test(type) || event.resourceType === "account";

  const orgId = connector.org_id;
  const conn = { id: connector.id, org_id: connector.org_id, type: "mercury" as const };

  // Durable archive of the raw event (no-op unless capture is enabled for this connector).
  await captureEvent(supabase, {
    provider: "mercury", connectorId: connector.id, orgId: connector.org_id,
    eventId: (event as { id?: string }).id ?? null, eventType: type || null,
    signatureOk: true, payload: event,
  });

  after(async () => {
    const sb = await createServiceClient();
    try {
      if (isTransaction) {
        // Enqueue an incremental sync (coalesced — skipped if one's already running)
        // and drain it now, then categorize any freshly-synced bank rows.
        await enqueueIncremental(sb, conn);
        await drainSyncJobs(sb, randomUUID());
        await categorizeBankTransactions(orgId, sb);
      } else if (isBalance) {
        await refreshMercuryBalances(sb, { id: connector.id, org_id: connector.org_id, config: connector.config });
      }
    } catch (e) {
      console.error("[mercury webhook] async processing failed:", e);
    }
  });

  await logWebhook(supabase, {
    outcome: "persisted",
    signature_ok: true,
    event_type: type || "unknown",
    connector_id: connector.id,
    org_id: connector.org_id,
    external_id: event.resourceId ?? null,
    status: isTransaction ? "transaction" : isBalance ? "balance" : "other",
  });
  return NextResponse.json({ received: true }, { status: 200 });
}
