import crypto from "crypto";
import type { createServiceClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

/**
 * Durable event capture (see migration 071 / gateway_events).
 *
 * Archives one inbound gateway event VERBATIM the instant it arrives — before any
 * normalization — so a parsing/derivation bug can never lose it. Idempotent (dedup on
 * provider+connector+dedup_key), fully best-effort: a capture failure NEVER changes what
 * the webhook returns to the gateway. Gated per connector by connectors.capture_events,
 * so nothing is stored until a gateway is explicitly enabled.
 *
 * Usage: call once per request, right after the connector is matched and the body is
 * parsed. Existing inline normalization is untouched — capture is purely additive.
 */

// Per-instance cache of the capture flag so we don't re-query connectors on every
// webhook. Serverless instances are short-lived; a 60s TTL is plenty and self-heals
// after a toggle. Keyed by connector id.
const flagCache = new Map<string, { enabled: boolean; exp: number }>();
const FLAG_TTL_MS = 60_000;

async function captureEnabled(supabase: ServiceClient, connectorId: string): Promise<boolean> {
  const hit = flagCache.get(connectorId);
  const now = Date.now();
  if (hit && hit.exp > now) return hit.enabled;
  const { data } = await supabase
    .from("connectors")
    .select("capture_events")
    .eq("id", connectorId)
    .maybeSingle();
  const enabled = data?.capture_events === true;
  flagCache.set(connectorId, { enabled, exp: now + FLAG_TTL_MS });
  return enabled;
}

/** Stable content hash of a payload — the dedup fallback when a gateway gives no
 *  native event id. jsonb output is canonical, and a re-delivered webhook is byte-
 *  identical, so the same event always hashes the same. */
function contentHash(payload: unknown): string {
  return "sha256:" + crypto.createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
}

export type CaptureArgs = {
  provider: string;              // stripe|razorpay|cashfree|payu|paytm|easebuzz|app_store|mercury
  connectorId: string;
  orgId: string | null;
  payload: unknown;              // the FULL parsed event
  /** Native event id when the gateway provides one (evt_…, notificationUUID, x-razorpay-event-id). */
  eventId?: string | null;
  eventType?: string | null;
  /** When the event happened at the gateway (ISO), when known. */
  occurredAt?: string | null;
  signatureOk?: boolean;
  source?: "webhook" | "backfill" | "poll";
};

/**
 * Archive an inbound event. No-op (silently) when capture is disabled for the connector
 * or when connectorId is missing. Never throws.
 */
export async function captureEvent(supabase: ServiceClient, args: CaptureArgs): Promise<void> {
  try {
    if (!args.connectorId) return;
    if (!(await captureEnabled(supabase, args.connectorId))) return;

    const dedupKey = (args.eventId && args.eventId.length > 0) ? args.eventId : contentHash(args.payload);
    const row: Database["public"]["Tables"]["gateway_events"]["Insert"] = {
      provider: args.provider,
      connector_id: args.connectorId,
      org_id: args.orgId,
      event_id: args.eventId ?? null,
      event_type: args.eventType ?? null,
      dedup_key: dedupKey,
      occurred_at: args.occurredAt ?? null,
      signature_ok: args.signatureOk ?? false,
      source: args.source ?? "webhook",
      payload: (args.payload ?? null) as Json,
    };
    // Idempotent: re-delivered webhooks collapse onto the existing row.
    await supabase
      .from("gateway_events")
      .upsert(row, { onConflict: "provider,connector_id,dedup_key", ignoreDuplicates: true });
  } catch (e) {
    console.error(`[capture:${args.provider}] event archive failed (non-fatal):`, e);
  }
}
