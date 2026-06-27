import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/server";
import { persistTransactions } from "@/lib/connectors/sync";
import {
  normalizeStripeCharge,
  normalizeStripePayout,
  normalizeStripeDispute,
  type NormalizedTransaction,
  type StripeCharge,
  type StripePayout,
  type StripeDispute,
} from "@/lib/normalizer";

export const maxDuration = 30;

const CHARGE_EVENTS = new Set([
  "charge.succeeded", "charge.failed", "charge.captured", "charge.updated", "charge.refunded",
]);
const DISPUTE_EVENTS = new Set([
  "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed",
  "charge.dispute.funds_withdrawn", "charge.dispute.funds_reinstated",
]);
const PAYOUT_EVENTS = new Set([
  "payout.created", "payout.updated", "payout.paid", "payout.failed", "payout.canceled",
]);

/**
 * POST /api/webhooks/stripe — real-time ingestion of Stripe events.
 *
 * Mirrors the events-delta sync: charges (incl. refunded → status change), disputes
 * and payouts, normalized and persisted through persistTransactions (same FX/dedup/
 * fee path as the sync). Signature is verified with STRIPE_WEBHOOK_SECRET only — the
 * event payload carries the object, so no Stripe API key is needed here. Idempotent
 * (upsert on org_id,connector_id,external_id). Note: charges arriving via webhook
 * lack the processing fee (it's on the balance transaction, not the event); the
 * periodic backfill reconciles fees, exactly like the events-delta path.
 *
 * Setup: register this URL in the Stripe dashboard, put its signing secret in
 * STRIPE_WEBHOOK_SECRET, and subscribe to charge.* / charge.dispute.* / payout.*.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[stripe webhook] STRIPE_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  // constructEvent only needs the webhook secret; the API key is irrelevant here.
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "unused_for_webhook_verification", {
    apiVersion: "2025-02-24.acacia",
    typescript: true,
  });

  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Signature verification failed";
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  const obj = event.data.object as unknown;
  const txns: NormalizedTransaction[] = [];
  if (DISPUTE_EVENTS.has(event.type)) txns.push(normalizeStripeDispute(obj as StripeDispute));
  else if (PAYOUT_EVENTS.has(event.type)) txns.push(normalizeStripePayout(obj as StripePayout));
  else if (CHARGE_EVENTS.has(event.type)) txns.push(normalizeStripeCharge(obj as StripeCharge));

  if (txns.length === 0) {
    return NextResponse.json({ received: true, ignored: event.type }, { status: 200 });
  }

  const supabase = await createServiceClient();
  const { data: connectors } = await supabase
    .from("connectors")
    .select("id, org_id, config")
    .eq("type", "stripe")
    .eq("status", "active");

  // event.account is set only for Connect; match it against the connector's stored
  // account id (mid, unencrypted). Otherwise fall back to the sole active connector.
  const list = connectors ?? [];
  const account = event.account;
  let matched: { id: string; org_id: string } | null = null;
  if (account) {
    const m = list.filter((c) => (c.config as Record<string, string>)?.mid === account);
    if (m.length === 1) matched = m[0];
  }
  if (!matched && list.length === 1) matched = list[0];

  if (!matched) {
    console.warn(`[stripe webhook] no unique connector match (account=${account ?? "none"}); ${event.type} skipped`);
    return NextResponse.json({ received: true, unmatched: true }, { status: 200 });
  }

  try {
    await persistTransactions(supabase, matched.org_id, matched.id, txns);
  } catch (err) {
    console.error(`[stripe webhook] persist failed for ${event.type}:`, err);
    return NextResponse.json({ error: "Persist failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
