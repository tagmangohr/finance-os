import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { persistTransactions } from "@/lib/connectors/sync";
import { persistSubscriptionResult } from "@/lib/subscriptions/persist";
import { razorpaySubscriptionAdapter } from "@/lib/subscriptions/adapters/razorpay";
import type { NormalizedSubscriptionEvent } from "@/lib/subscriptions/types";
import {
  normalizeRazorpayPayment,
  normalizeRazorpayRefund,
  normalizeRazorpayDispute,
  normalizeRazorpaySettlement,
  type NormalizedTransaction,
  type RazorpayPayment,
  type RazorpayRefund,
  type RazorpayDispute,
  type RazorpaySettlement,
} from "@/lib/normalizer";
import type { Database } from "@/lib/supabase/types";

export const maxDuration = 30;

type SupabaseLike = Awaited<ReturnType<typeof createServiceClient>>;
type WebhookEventInsert = Database["public"]["Tables"]["webhook_events"]["Insert"];

/** Record one inbound Razorpay webhook + its fate (observability, like Cashfree/App
 *  Store). Best-effort: a logging failure never changes what we return to Razorpay. */
async function logWebhook(
  supabase: SupabaseLike,
  row: Partial<WebhookEventInsert> & { outcome: WebhookEventInsert["outcome"]; signature_ok: boolean }
): Promise<void> {
  const full: WebhookEventInsert = {
    provider: "razorpay",
    event_type: null, connector_id: null, org_id: null, external_id: null,
    order_id: null, amount: null, status: null, error: null, payload: null,
    ...row,
  };
  try { await supabase.from("webhook_events").insert(full); }
  catch (e) { console.error("[razorpay webhook] event log insert failed (non-fatal):", e); }
}

const peekType = (raw: string): string | null => {
  try { return (JSON.parse(raw) as { event?: string }).event ?? null; } catch { return null; }
};

/**
 * POST /api/webhooks/razorpay — real-time ingestion of Razorpay events.
 *
 * Handles payments, refunds, disputes, settlements AND subscriptions
 * (subscription.activated/charged/cancelled/…). Subscription charges land as a
 * transaction tagged with subscription_id (no double-count) plus a lifecycle/charge
 * event; the subscription snapshot is upserted (merge, non-null). Every inbound event
 * is logged to webhook_events for observability. Idempotent (dedup on external_id /
 * (gateway,event_ref)), so Razorpay retries are safe.
 *
 * Setup (per Razorpay account): dashboard webhook → this URL, secret =
 * RAZORPAY_WEBHOOK_SECRET (env), subscribed to payment.*, refund.*,
 * payment.dispute.*, settlement.* and subscription.* events.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createServiceClient();
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const rawBody = await req.text();

  if (!webhookSecret) {
    console.error("[razorpay webhook] RAZORPAY_WEBHOOK_SECRET not configured");
    await logWebhook(supabase, { outcome: "persist_error", signature_ok: false, event_type: peekType(rawBody), error: "RAZORPAY_WEBHOOK_SECRET not configured" });
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  // Signature verification (HMAC-SHA256 of the raw body with the webhook secret).
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    await logWebhook(supabase, { outcome: "signature_failed", signature_ok: false, event_type: peekType(rawBody) });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { event?: string; payload?: Record<string, { entity?: unknown }> };
  try { event = JSON.parse(rawBody); }
  catch { await logWebhook(supabase, { outcome: "bad_json", signature_ok: true }); return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const type = event.event ?? "";
  const payload = event.payload ?? {};

  // Match the connector by its public key_id (not a secret), else the sole active one.
  const { data: connectors } = await supabase
    .from("connectors").select("id, org_id, config").eq("type", "razorpay").eq("status", "active");
  const keyId = req.headers.get("x-razorpay-key-id");
  const list = connectors ?? [];
  let matched: { id: string; org_id: string } | null = null;
  if (keyId) { const m = list.filter((c) => (c.config as Record<string, string>)?.key_id === keyId); if (m.length === 1) matched = m[0]; }
  if (!matched && list.length === 1) matched = list[0];
  if (!matched) {
    await logWebhook(supabase, { outcome: "unmatched", signature_ok: true, event_type: type, order_id: keyId });
    return NextResponse.json({ received: true, unmatched: true }, { status: 200 });
  }

  // ── Subscription events ──────────────────────────────────────────────────────
  if (type.startsWith("subscription.")) {
    const sub = payload.subscription?.entity as { id?: string } | undefined;
    if (!sub?.id) {
      await logWebhook(supabase, { outcome: "ignored", signature_ok: true, event_type: type, connector_id: matched.id, org_id: matched.org_id });
      return NextResponse.json({ received: true, ignored: type }, { status: 200 });
    }
    const result = razorpaySubscriptionAdapter(sub as never, {});
    // subscription.charged carries the payment → a tagged transaction + charge event.
    let txn: NormalizedTransaction | null = null;
    if (type === "subscription.charged") {
      const pay = payload.payment?.entity as RazorpayPayment | undefined;
      if (pay) {
        txn = normalizeRazorpayPayment(pay);
        txn.subscription_id = sub.id; // tag the charge (no double-count; dedup on pay_ id)
        const ev: NormalizedSubscriptionEvent = {
          gateway: "razorpay", subscription_id: sub.id,
          event_type: txn.status === "completed" ? "charge_succeeded" : "charge_failed",
          native_event_type: type, event_at: txn.transaction_at ?? new Date().toISOString(),
          amount: txn.amount, currency: txn.currency,
          transaction_external_id: txn.external_id, event_ref: `rzp_subchg_${txn.external_id}`, raw: pay,
        };
        result.events.push(ev);
      }
    }
    try {
      await persistSubscriptionResult(supabase, matched.org_id, matched.id, result);
      if (txn) await persistTransactions(supabase, matched.org_id, matched.id, [txn]);
    } catch (err) {
      await logWebhook(supabase, { outcome: "persist_error", signature_ok: true, event_type: type, connector_id: matched.id, org_id: matched.org_id, error: err instanceof Error ? err.message : String(err) });
      return NextResponse.json({ error: "Persist failed" }, { status: 500 });
    }
    await logWebhook(supabase, { outcome: "persisted", signature_ok: true, event_type: type, connector_id: matched.id, org_id: matched.org_id, external_id: txn?.external_id ?? sub.id, amount: txn?.amount ?? null, status: txn?.status ?? null });
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // ── Transaction events (payment / refund / dispute / settlement) ─────────────
  // Order matters: dispute events are also prefixed "payment." so check them first.
  const txns: NormalizedTransaction[] = [];
  if (type.startsWith("payment.dispute.")) { const d = payload.dispute?.entity as RazorpayDispute | undefined; if (d) txns.push(normalizeRazorpayDispute(d)); }
  else if (type.startsWith("payment.")) { const p = payload.payment?.entity as RazorpayPayment | undefined; if (p) txns.push(normalizeRazorpayPayment(p)); }
  else if (type.startsWith("refund.")) { const r = payload.refund?.entity as RazorpayRefund | undefined; if (r) txns.push(normalizeRazorpayRefund(r)); }
  else if (type.startsWith("settlement.")) { const s = payload.settlement?.entity as RazorpaySettlement | undefined; if (s) txns.push(normalizeRazorpaySettlement(s)); }

  if (txns.length === 0) {
    await logWebhook(supabase, { outcome: "ignored", signature_ok: true, event_type: type, connector_id: matched.id, org_id: matched.org_id });
    return NextResponse.json({ received: true, ignored: type }, { status: 200 });
  }

  try {
    await persistTransactions(supabase, matched.org_id, matched.id, txns);
  } catch (err) {
    await logWebhook(supabase, { outcome: "persist_error", signature_ok: true, event_type: type, connector_id: matched.id, org_id: matched.org_id, error: err instanceof Error ? err.message : String(err) });
    console.error(`[razorpay webhook] persist failed for ${type}:`, err);
    return NextResponse.json({ error: "Persist failed" }, { status: 500 });
  }

  await logWebhook(supabase, { outcome: "persisted", signature_ok: true, event_type: type, connector_id: matched.id, org_id: matched.org_id, external_id: txns[0].external_id, amount: txns[0].amount, status: txns[0].status });
  return NextResponse.json({ received: true }, { status: 200 });
}
