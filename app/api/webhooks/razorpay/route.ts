import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { persistTransactions } from "@/lib/connectors/sync";
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

export const maxDuration = 30;

/**
 * POST /api/webhooks/razorpay — real-time ingestion of Razorpay events.
 *
 * Covers payments, refunds, disputes and settlements (not just captures), and
 * persists through persistTransactions so each event gets the SAME FX conversion,
 * dedup, and fee handling as the batch sync. Idempotent: upsert on
 * (org_id, connector_id, external_id), so Razorpay's retries are safe.
 *
 * Setup (per Razorpay account): create a webhook in the Razorpay dashboard pointing
 * at this URL, set its secret as RAZORPAY_WEBHOOK_SECRET in the env, and subscribe
 * to the payment.*, refund.*, payment.dispute.* (and optionally settlement.*) events.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[razorpay webhook] RAZORPAY_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  // Raw body is required for signature verification.
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { event?: string; payload?: Record<string, { entity?: unknown }> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const type = event.event ?? "";
  const payload = event.payload ?? {};

  // Map the event to normalized transaction(s). Order matters: dispute events are
  // also prefixed "payment." so check them first.
  const txns: NormalizedTransaction[] = [];
  if (type.startsWith("payment.dispute.")) {
    const d = payload.dispute?.entity as RazorpayDispute | undefined;
    if (d) txns.push(normalizeRazorpayDispute(d));
  } else if (type.startsWith("payment.")) {
    const p = payload.payment?.entity as RazorpayPayment | undefined;
    if (p) txns.push(normalizeRazorpayPayment(p));
  } else if (type.startsWith("refund.")) {
    const r = payload.refund?.entity as RazorpayRefund | undefined;
    if (r) txns.push(normalizeRazorpayRefund(r));
  } else if (type.startsWith("settlement.")) {
    const s = payload.settlement?.entity as RazorpaySettlement | undefined;
    if (s) txns.push(normalizeRazorpaySettlement(s));
  }

  // Unhandled event types: ack so Razorpay doesn't retry.
  if (txns.length === 0) {
    return NextResponse.json({ received: true, ignored: type }, { status: 200 });
  }

  const supabase = await createServiceClient();
  const { data: connectors } = await supabase
    .from("connectors")
    .select("id, org_id, config")
    .eq("type", "razorpay")
    .eq("status", "active");

  // Match the connector by its public key_id (NOT a secret — stored unencrypted).
  // Fall back to the sole active connector when the header is absent.
  const keyId = req.headers.get("x-razorpay-key-id");
  const list = connectors ?? [];
  let matched: { id: string; org_id: string } | null = null;
  if (keyId) {
    const m = list.filter((c) => (c.config as Record<string, string>)?.key_id === keyId);
    if (m.length === 1) matched = m[0];
  }
  if (!matched && list.length === 1) matched = list[0];

  if (!matched) {
    // Not retryable (config issue, not transient) — ack and log.
    console.warn(`[razorpay webhook] no unique connector match (key_id=${keyId ?? "none"}); ${type} skipped`);
    return NextResponse.json({ received: true, unmatched: true }, { status: 200 });
  }

  try {
    await persistTransactions(supabase, matched.org_id, matched.id, txns);
  } catch (err) {
    // Transient (DB) — return 500 so Razorpay retries; idempotent so it's safe.
    console.error(`[razorpay webhook] persist failed for ${type}:`, err);
    return NextResponse.json({ error: "Persist failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
