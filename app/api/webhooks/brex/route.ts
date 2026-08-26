import { NextRequest, NextResponse, after } from "next/server";
import crypto from "crypto";
import { randomUUID } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { connectorByToken } from "@/lib/connectors/webhook-connector";
import { decryptConfigSecrets } from "@/lib/crypto/secrets";
import { enqueueIncremental, drainSyncJobs } from "@/lib/connectors/jobs";
import { captureEvent } from "@/lib/events/capture";
import { categorizeBankTransactions } from "@/lib/expenses/categorize";
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
    provider: "brex",
    event_type: null, connector_id: null, org_id: null, external_id: null,
    order_id: null, amount: null, status: null, error: null, payload: null,
    ...row,
  };
  try { await supabase.from("webhook_events").insert(full); }
  catch (e) { console.error("[brex webhook] event log insert failed (non-fatal):", e); }
}

const peekType = (raw: string): string | null => {
  try { return (JSON.parse(raw) as { event_type?: string; type?: string }).event_type ?? (JSON.parse(raw) as { type?: string }).type ?? null; }
  catch { return null; }
};

/**
 * POST /api/webhooks/brex  (?c=<webhook_token> pins the account)
 *
 * Brex signs webhooks the Svix way:
 *   Webhook-Id:        <msg id>
 *   Webhook-Timestamp: <unix seconds>
 *   Webhook-Signature: space-delimited "v1,<base64 HMAC-SHA256>" entries
 * signed over  `${id}.${timestamp}.${rawBody}`  with the endpoint's signing secret
 * (base64, `whsec_`-prefixed — obtained from GET /v1/webhooks/secrets and pasted
 * into this connector's Webhook Signing Secret field).
 *
 * We treat every Brex event as a TRIGGER (the payloads vary — TRANSFER_*, EXPENSE_*,
 * USER_UPDATED, REFERRAL_*): verify, archive, then enqueue an incremental sync that
 * pulls the authoritative card + cash transactions and categorizes them. So ALL
 * event types are captured uniformly without brittle per-event parsing.
 * Until a signing secret is saved we ACK 200 (so Brex's endpoint test passes).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createServiceClient();
  const rawBody = await req.text();

  const cParam = req.nextUrl.searchParams.get("c");
  const tokenConn = await connectorByToken(supabase, "brex", cParam);
  let connector: { id: string; org_id: string; config: Record<string, unknown> | null } | null =
    tokenConn ? { id: tokenConn.id, org_id: tokenConn.org_id, config: tokenConn.config } : null;
  if (!connector) {
    const { data: conns } = await supabase.from("connectors").select("id, org_id, config").eq("type", "brex").eq("status", "active");
    const list = conns ?? [];
    connector = (list.length === 1 ? list[0] : null) as { id: string; org_id: string; config: Record<string, unknown> | null } | null;
  }
  if (!connector) {
    await logWebhook(supabase, { outcome: "unmatched", signature_ok: false, event_type: peekType(rawBody) });
    return NextResponse.json({ received: true, unmatched: true }, { status: 200 });
  }

  const secret = decryptConfigSecrets((connector.config ?? {}) as Record<string, string>).webhook_secret;
  if (!secret) {
    await logWebhook(supabase, { outcome: "ignored", signature_ok: false, event_type: peekType(rawBody), connector_id: connector.id, org_id: connector.org_id, error: "webhook_secret not configured" });
    return NextResponse.json({ received: true, note: "secret not configured" }, { status: 200 });
  }

  // ── Svix-style verification ──
  const id = req.headers.get("webhook-id") ?? "";
  const ts = req.headers.get("webhook-timestamp") ?? "";
  const sigHeader = req.headers.get("webhook-signature") ?? "";
  if (!id || !ts || !sigHeader) {
    await logWebhook(supabase, { outcome: "signature_failed", signature_ok: false, event_type: peekType(rawBody), connector_id: connector.id, org_id: connector.org_id, error: "missing signature headers" });
    return NextResponse.json({ error: "Invalid signature headers" }, { status: 401 });
  }
  // Replay guard: 5-minute tolerance.
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(ts));
  if (!Number.isFinite(skew) || skew > 300) {
    await logWebhook(supabase, { outcome: "signature_failed", signature_ok: true, event_type: peekType(rawBody), connector_id: connector.id, org_id: connector.org_id, error: `stale timestamp (${skew}s)` });
    return NextResponse.json({ error: "Stale signature" }, { status: 401 });
  }
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", secretBytes).update(`${id}.${ts}.${rawBody}`).digest("base64");
  // Header is space-delimited "v1,<b64>" entries — accept if any matches.
  const provided = sigHeader.split(" ").map((p) => (p.includes(",") ? p.split(",")[1] : p));
  const ok = provided.some((p) => {
    const a = Buffer.from(p, "base64"); const b = Buffer.from(expected, "base64");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!ok) {
    await logWebhook(supabase, { outcome: "signature_failed", signature_ok: false, event_type: peekType(rawBody), connector_id: connector.id, org_id: connector.org_id });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { event_type?: string; type?: string; id?: string };
  try { event = JSON.parse(rawBody); }
  catch { await logWebhook(supabase, { outcome: "bad_json", signature_ok: true, connector_id: connector.id, org_id: connector.org_id }); return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const type = event.event_type ?? event.type ?? "";
  const orgId = connector.org_id;
  const conn = { id: connector.id, org_id: connector.org_id, type: "brex" as const };

  await captureEvent(supabase, {
    provider: "brex", connectorId: connector.id, orgId,
    eventId: id || event.id || null, eventType: type || null, signatureOk: true, payload: event,
  });

  // Every Brex event → trigger an incremental sync (authoritative pull) + categorize.
  after(async () => {
    const sb = await createServiceClient();
    try {
      await enqueueIncremental(sb, conn);
      await drainSyncJobs(sb, randomUUID());
      await categorizeBankTransactions(orgId, sb);
    } catch (e) {
      console.error("[brex webhook] async processing failed:", e);
    }
  });

  await logWebhook(supabase, { outcome: "persisted", signature_ok: true, event_type: type || "unknown", connector_id: connector.id, org_id: orgId });
  return NextResponse.json({ received: true }, { status: 200 });
}
