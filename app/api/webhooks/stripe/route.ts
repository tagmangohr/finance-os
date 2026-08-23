import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/server";
import { persistTransactions } from "@/lib/connectors/sync";
import { connectorByToken } from "@/lib/connectors/webhook-connector";
import { captureEvent } from "@/lib/events/capture";
import {
  normalizeStripeCharge,
  stripeRefundFromCharge,
  normalizeStripePayout,
  normalizeStripeDispute,
  isTagMangoCharge,
  type NormalizedTransaction,
  type StripeCharge,
  type StripePayout,
  type StripeDispute,
} from "@/lib/normalizer";
import { stripeSubscriptionAdapter } from "@/lib/subscriptions/adapters/stripe";
import { persistSubscriptionResult, insertSubscriptionEvents } from "@/lib/subscriptions/persist";

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
// Subscription lifecycle → upsert the subscriptions master (+ created/cancelled events).
const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created", "customer.subscription.updated",
  "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed",
]);
// Recurring invoices → renewal (charge_succeeded) / dunning (charge_failed) events.
const INVOICE_EVENTS = new Set(["invoice.paid", "invoice.payment_failed"]);

// TagMango shares this Stripe account. Charges are split by statement descriptor
// (isTagMangoCharge); subscriptions/invoices carry no descriptor, so key off the
// TagMango-only metadata (mango/creator/fan) — matches the CSV reconciliation.
function isTagMangoStripeMeta(m?: Stripe.Metadata | null): boolean {
  if (!m) return false;
  return !!(m.mango || m.creator || m.fan);
}

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
 * STRIPE_WEBHOOK_SECRET, and subscribe to charge.* / charge.dispute.* / payout.* /
 * customer.subscription.* / invoice.paid / invoice.payment_failed. Subscription
 * events upsert the subscriptions master (same path as the nightly sync); invoice
 * events log renewal/dunning subscription_events.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createServiceClient();
  // Per-account routing: ?c=<token> pins the connector and its own signing secret.
  const tokenConn = await connectorByToken(supabase, "stripe", req.nextUrl.searchParams.get("c"));
  const webhookSecret = (tokenConn?.config.webhook_secret as string | undefined) || process.env.STRIPE_WEBHOOK_SECRET;
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

  // ── Classify the event ──────────────────────────────────────────────────────
  const txns: NormalizedTransaction[] = [];
  if (DISPUTE_EVENTS.has(event.type)) txns.push(normalizeStripeDispute(obj as StripeDispute));
  else if (PAYOUT_EVENTS.has(event.type)) txns.push(normalizeStripePayout(obj as StripePayout));
  else if (CHARGE_EVENTS.has(event.type)) {
    const c = obj as StripeCharge;
    if (!isTagMangoCharge(c)) {
      txns.push(normalizeStripeCharge(c)); // exclude shared-account TagMango charges
      const refund = stripeRefundFromCharge(c); // emit a refund line-item if the charge is (partly) refunded
      if (refund) txns.push(refund);
    }
  }
  const isSub = SUBSCRIPTION_EVENTS.has(event.type);
  const isInvoice = INVOICE_EVENTS.has(event.type);

  if (txns.length === 0 && !isSub && !isInvoice) {
    return NextResponse.json({ received: true, ignored: event.type }, { status: 200 });
  }

  // Prefer the token-pinned connector; else match event.account (Connect) → mid, else sole active.
  let matched: { id: string; org_id: string } | null = tokenConn ? { id: tokenConn.id, org_id: tokenConn.org_id } : null;
  if (!matched) {
    const { data: connectors } = await supabase
      .from("connectors")
      .select("id, org_id, config")
      .eq("type", "stripe")
      .eq("status", "active");
    const list = connectors ?? [];
    const account = event.account;
    if (account) {
      const m = list.filter((c) => (c.config as Record<string, string>)?.mid === account);
      if (m.length === 1) matched = m[0];
    }
    if (!matched && list.length === 1) matched = list[0];
  }

  if (!matched) {
    console.warn(`[stripe webhook] no unique connector match (account=${event.account ?? "none"}); ${event.type} skipped`);
    return NextResponse.json({ received: true, unmatched: true }, { status: 200 });
  }

  // Durable archive of the raw event (no-op unless capture is enabled for this connector).
  await captureEvent(supabase, {
    provider: "stripe", connectorId: matched.id, orgId: matched.org_id,
    eventId: event.id, eventType: event.type,
    occurredAt: typeof event.created === "number" ? new Date(event.created * 1000).toISOString() : null,
    signatureOk: true, payload: event,
  });

  // ── Transactions (charge / dispute / payout) ────────────────────────────────
  if (txns.length > 0) {
    try {
      await persistTransactions(supabase, matched.org_id, matched.id, txns);
    } catch (err) {
      console.error(`[stripe webhook] persist failed for ${event.type}:`, err);
      return NextResponse.json({ error: "Persist failed" }, { status: 500 });
    }
  }

  // ── Subscription lifecycle → upsert master (+ created/cancelled events) ──────
  // Reuses the exact nightly-sync path (adapter + persist) so there's no drift.
  if (isSub) {
    const sub = obj as Stripe.Subscription;
    if (!isTagMangoStripeMeta(sub.metadata)) {
      try {
        await persistSubscriptionResult(
          supabase, matched.org_id, matched.id,
          stripeSubscriptionAdapter(sub as unknown as Parameters<typeof stripeSubscriptionAdapter>[0])
        );
      } catch (err) {
        console.error(`[stripe webhook] subscription persist failed for ${event.type}:`, err);
      }
    }
  }

  // ── Recurring invoice → renewal (paid) / dunning (failed) event ─────────────
  if (isInvoice) {
    const inv = obj as Stripe.Invoice & {
      subscription?: string | { id?: string } | null;
      charge?: string | { id?: string } | null;
      subscription_details?: { metadata?: Stripe.Metadata | null } | null;
    };
    const subId = typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id ?? null;
    const meta = inv.subscription_details?.metadata ?? inv.metadata;
    // Only subscription invoices, and skip TagMango.
    if (subId && !isTagMangoStripeMeta(meta)) {
      const paid = event.type === "invoice.paid";
      const chargeId = typeof inv.charge === "string" ? inv.charge : inv.charge?.id ?? null;
      const amtMinor = (paid ? inv.amount_paid : inv.amount_due) ?? 0;
      const whenSec = inv.status_transitions?.paid_at ?? inv.created;
      try {
        await insertSubscriptionEvents(supabase, matched.org_id, [{
          gateway: "stripe",
          subscription_id: subId,
          event_type: paid ? "charge_succeeded" : "charge_failed",
          native_event_type: event.type,
          event_at: new Date((whenSec ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
          amount: amtMinor / 100,
          currency: (inv.currency ?? "usd").toUpperCase(),
          transaction_external_id: chargeId,
          event_ref: `stripe_inv_${inv.id}_${paid ? "paid" : "failed"}`,
          raw: inv as unknown as Record<string, unknown>,
        }]);
      } catch (err) {
        console.error(`[stripe webhook] invoice event failed for ${event.type}:`, err);
      }
    }
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
