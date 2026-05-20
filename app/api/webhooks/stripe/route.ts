import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createServiceClient } from "@/lib/supabase/server";
import {
  normalizeStripeCharge,
  StripeCharge,
} from "@/lib/normalizer";
import type { Database } from "@/lib/supabase/types";

type TransactionInsert =
  Database["public"]["Tables"]["transactions"]["Insert"];

// ─── POST /api/webhooks/stripe ────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[stripe webhook] STRIPE_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? "";
  const stripe = new Stripe(stripeSecretKey, {
    apiVersion: "2025-02-24.acacia",
    typescript: true,
  });

  // Read raw body for signature verification
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";

  // ── Verify Stripe webhook signature ───────────────────────────────────────
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Signature verification failed";
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  // Return 200 immediately after verification
  const supabase = await createServiceClient();

  // ── Handle supported events ───────────────────────────────────────────────
  if (event.type === "charge.succeeded" || event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;

    const normalized = normalizeStripeCharge(charge as unknown as StripeCharge);

    // Determine the matching connector by looking up active Stripe connectors
    // The webhook endpoint can be registered per account, so we match by
    // account (if Stripe-Account header is set) or fall back to first active connector
    const stripeAccount = req.headers.get("stripe-account");

    const { data: connectors } = await supabase
      .from("connectors")
      .select("id, org_id, config")
      .eq("type", "stripe")
      .eq("status", "active");

    const matchedConnector = connectors?.find((c) => {
      if (!stripeAccount) return true; // take first active
      const cfg = c.config as Record<string, string>;
      return cfg?.account_id === stripeAccount;
    });

    if (matchedConnector) {
      const row: TransactionInsert = {
        org_id: matchedConnector.org_id,
        connector_id: matchedConnector.id,
        external_id: normalized.external_id,
        type: normalized.type,
        amount: normalized.amount,
        currency: normalized.currency,
        category: normalized.category,
        category_confidence: null,
        counterparty_id: null,
        counterparty_name: normalized.counterparty_name,
        description: normalized.description,
        source: normalized.source,
        status: normalized.status,
        transaction_date: normalized.transaction_date,
        metadata: normalized.metadata as import("@/lib/supabase/types").Json,
      };

      await supabase
        .from("transactions")
        .upsert([row], { onConflict: "org_id,connector_id,external_id" });
    }
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
