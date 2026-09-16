import { NextRequest, NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { decryptValue } from "@/lib/crypto/secrets";
import { buildWebhookPayload, signWebhookBody, type WebhookEventType } from "@/lib/webhooks/contract";
import { nextBackoffMs } from "@/lib/webhooks/endpoints";
import { logCronRun } from "@/lib/ops/cron-runs";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/deliver-webhooks — drains the outbound webhook outbox.
 *
 * Claims a batch atomically (claim_webhook_deliveries → FOR UPDATE SKIP LOCKED, so
 * overlapping cron runs never double-send), POSTs each with an HMAC signature, and
 * records the result. Retries with exponential backoff; dead-letters after
 * max_attempts. Runs every minute; safe to overlap. Returns fast and works in after().
 */
const BATCH = 50;

type DeliveryRow = {
  id: string; org_id: string; endpoint_id: string; event_id: string;
  event_type: string; tx_snapshot: Record<string, unknown>; attempts: number; max_attempts: number;
};
type EndpointRow = { id: string; url: string; secret: string; enabled: boolean };

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Cron is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  after(async () => {
    const startedAt = Date.now();
    const supabase = await createServiceClient();
    try {
      const { data: claimed, error } = await supabase.rpc("claim_webhook_deliveries" as never, { p_limit: BATCH } as never);
      if (error) throw new Error(error.message ?? "claim_webhook_deliveries failed");
      const rows = (claimed ?? []) as DeliveryRow[];

      if (rows.length > 0) {
        // Load the endpoints referenced by this batch in one query (url + secret).
        const endpointIds = [...new Set(rows.map((r) => r.endpoint_id))];
        const { data: eps } = await supabase
          .from("webhook_endpoints")
          .select("id, url, secret, enabled")
          .in("id", endpointIds);
        const epById = new Map<string, EndpointRow>(((eps ?? []) as EndpointRow[]).map((e) => [e.id, e]));

        await Promise.all(rows.map((row) => deliverOne(supabase, row, epById.get(row.endpoint_id))));
      }
      await logCronRun(supabase, "deliver-webhooks", startedAt, "ok", null, { claimed: rows.length });
    } catch (err) {
      // never throw from a cron; the lease auto-recovers stuck rows next run.
      await logCronRun(supabase, "deliver-webhooks", startedAt, "failed", err instanceof Error ? err.message : String(err));
    }
  });

  return NextResponse.json({ ok: true });
}

async function deliverOne(supabase: SupabaseClient, row: DeliveryRow, ep?: EndpointRow): Promise<void> {
  // Endpoint gone (shouldn't happen — cascade) or disabled → hold without burning an
  // attempt (undo the claim's increment), retry later.
  if (!ep || !ep.enabled) {
    await supabase.from("webhook_deliveries").update({
      status: "pending",
      attempts: Math.max(0, row.attempts - 1),
      next_attempt_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      last_error: ep ? "endpoint disabled" : "endpoint missing",
    }).eq("id", row.id);
    return;
  }

  const payload = buildWebhookPayload({
    eventId: row.event_id,
    eventType: row.event_type as WebhookEventType,
    orgId: row.org_id,
    snapshot: row.tx_snapshot,
  });
  const body = JSON.stringify(payload);
  const sig = signWebhookBody(decryptValue(ep.secret), body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let ok = false, code: number | null = null, errMsg: string | null = null;
  try {
    const res = await fetch(ep.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-FinanceOS-Event": row.event_type,
        "X-FinanceOS-Event-Id": row.event_id,
        "X-FinanceOS-Delivery": row.id,
        "X-FinanceOS-Signature": sig.header,
        "User-Agent": "FinanceOS-Webhooks/1.0",
      },
      body,
      signal: controller.signal,
    });
    code = res.status;
    ok = res.ok;
    if (!ok) errMsg = `HTTP ${res.status}`;
  } catch (e) {
    errMsg = e instanceof Error ? e.message : "request failed";
  } finally {
    clearTimeout(timer);
  }

  if (ok) {
    await supabase.from("webhook_deliveries").update({
      status: "delivered", delivered_at: new Date().toISOString(), response_code: code, last_error: null,
    }).eq("id", row.id);
    return;
  }

  // attempts was already incremented at claim time.
  const dead = row.attempts >= row.max_attempts;
  await supabase.from("webhook_deliveries").update({
    status: dead ? "dead" : "failed",
    response_code: code,
    last_error: errMsg,
    next_attempt_at: new Date(Date.now() + nextBackoffMs(row.attempts)).toISOString(),
  }).eq("id", row.id);
}
