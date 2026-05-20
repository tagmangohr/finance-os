import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import {
  normalizeRazorpayPayment,
  RazorpayPayment,
} from "@/lib/normalizer";
import type { Database } from "@/lib/supabase/types";

type TransactionInsert =
  Database["public"]["Tables"]["transactions"]["Insert"];

// ─── POST /api/webhooks/razorpay ──────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[razorpay webhook] RAZORPAY_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  // Read raw body for signature verification
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";

  // ── Verify HMAC-SHA256 signature ──────────────────────────────────────────
  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  if (
    !crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex")
    )
  ) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // ── Parse event ───────────────────────────────────────────────────────────
  let event: { event: string; payload: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType: string = event.event ?? "";
  const paymentEntity = (
    event.payload?.payment as { entity?: RazorpayPayment } | undefined
  )?.entity;

  // ── Handle supported events ───────────────────────────────────────────────
  if (
    (eventType === "payment.captured" || eventType === "payment.failed") &&
    paymentEntity
  ) {
    const normalized = normalizeRazorpayPayment(paymentEntity);

    // Look up the connector for this payment's org
    // We use a service-role client — org/connector resolution is by source key
    const supabase = await createServiceClient();

    const { data: connectors } = await supabase
      .from("connectors")
      .select("id, org_id, config")
      .eq("type", "razorpay")
      .eq("status", "active");

    // Match by key_id in connector config
    const webhookKeyId = req.headers.get("x-razorpay-key-id");
    const matchedConnector = connectors?.find((c) => {
      const cfg = c.config as Record<string, string>;
      return !webhookKeyId || cfg?.key_id === webhookKeyId;
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

  // Return 200 immediately after verification regardless of handler result
  return NextResponse.json({ received: true }, { status: 200 });
}
