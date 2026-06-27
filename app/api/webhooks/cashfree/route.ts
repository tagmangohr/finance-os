import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { persistTransactions } from "@/lib/connectors/sync";
import { decryptConfigSecrets } from "@/lib/crypto/secrets";
import { normalizeCashfreeWebhookEvent, type CashfreeWebhookPayload } from "@/lib/normalizer";

export const maxDuration = 30;

/**
 * POST /api/webhooks/cashfree — real-time payment & refund ingestion.
 *
 * Cashfree signs each webhook with the MERCHANT'S CLIENT SECRET (not a separate
 * webhook secret): signature = base64(HMAC-SHA256(`${timestamp}${rawBody}`, client_secret)),
 * in headers x-webhook-signature / x-webhook-timestamp. There's no connector id in
 * the payload, so verification doubles as matching: we try each active connector's
 * decrypted client_secret and the one whose secret verifies IS the connector.
 *
 * Normalized with external_ids that match the recon backfill (cf_pay_…, cf_refund_…)
 * so real-time rows dedup cleanly against it. Disputes come via the recon backfill.
 *
 * Setup: in the Cashfree dashboard, add a webhook to this URL and subscribe to the
 * payment + refund events. No env var needed — it verifies with the stored secret.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const signature = req.headers.get("x-webhook-signature") ?? "";
  const timestamp = req.headers.get("x-webhook-timestamp") ?? "";
  if (!signature || !timestamp) {
    return NextResponse.json({ error: "Missing signature headers" }, { status: 400 });
  }

  const supabase = await createServiceClient();
  const { data: connectors } = await supabase
    .from("connectors")
    .select("id, org_id, config")
    .eq("type", "cashfree")
    .eq("status", "active");

  // The connector whose client_secret reproduces the signature is the sender.
  const signed = `${timestamp}${rawBody}`;
  let matched: { id: string; org_id: string } | null = null;
  for (const c of connectors ?? []) {
    const cfg = decryptConfigSecrets((c.config ?? {}) as Record<string, string>);
    const secret = cfg.client_secret;
    if (!secret) continue;
    const expected = crypto.createHmac("sha256", secret).update(signed).digest("base64");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      matched = { id: c.id, org_id: c.org_id };
      break;
    }
  }
  if (!matched) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: CashfreeWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const txn = normalizeCashfreeWebhookEvent(payload);
  if (!txn) {
    return NextResponse.json({ received: true, ignored: payload?.type ?? "unknown" }, { status: 200 });
  }

  try {
    await persistTransactions(supabase, matched.org_id, matched.id, [txn]);
  } catch (err) {
    console.error(`[cashfree webhook] persist failed for ${payload?.type}:`, err);
    return NextResponse.json({ error: "Persist failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
