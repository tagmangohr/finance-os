import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { persistTransactions } from "@/lib/connectors/sync";
import { decryptConfigSecrets } from "@/lib/crypto/secrets";
import { normalizeCashfreeWebhookEvent, extractCashfreeSubscription, type CashfreeWebhookPayload } from "@/lib/normalizer";
import { cashfreeSubscriptionAdapter } from "@/lib/subscriptions/adapters/cashfree";
import { persistSubscriptionResult } from "@/lib/subscriptions/persist";
import type { Database } from "@/lib/supabase/types";

export const maxDuration = 30;

type WebhookEventInsert = Database["public"]["Tables"]["webhook_events"]["Insert"];
type SupabaseLike = Awaited<ReturnType<typeof createServiceClient>>;

/**
 * Record one inbound webhook and its fate. Best-effort: a logging failure (e.g. the
 * migration not applied yet) must NEVER change what we return to Cashfree, so it's
 * fully swallowed. This is what lets us tell "gateway never sent it" apart from
 * "we received it and dropped it" when reconciling capture gaps.
 */
async function logWebhook(
  supabase: SupabaseLike,
  row: Partial<WebhookEventInsert> & { outcome: WebhookEventInsert["outcome"]; signature_ok: boolean }
): Promise<void> {
  const full: WebhookEventInsert = {
    provider: "cashfree",
    event_type: null, connector_id: null, org_id: null, external_id: null,
    order_id: null, amount: null, status: null, error: null, payload: null,
    ...row,
  };
  try {
    await supabase.from("webhook_events").insert(full);
  } catch (e) {
    console.error("[cashfree webhook] event log insert failed (non-fatal):", e);
  }
}

/** Best-effort parse of the event type for logging, even before signature verification. */
function peekType(rawBody: string): string | null {
  try {
    return (JSON.parse(rawBody) as { type?: string })?.type ?? null;
  } catch {
    return null;
  }
}

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

  const supabase = await createServiceClient();

  if (!signature || !timestamp) {
    await logWebhook(supabase, { outcome: "missing_headers", event_type: peekType(rawBody), signature_ok: false });
    return NextResponse.json({ error: "Missing signature headers" }, { status: 400 });
  }

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
    await logWebhook(supabase, { outcome: "signature_failed", event_type: peekType(rawBody), signature_ok: false });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: CashfreeWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    await logWebhook(supabase, { outcome: "bad_json", signature_ok: true, connector_id: matched.id, org_id: matched.org_id });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── Subscription registry ──────────────────────────────────────────────────
  // Cashfree has NO list-subscriptions API, so the only way we enumerate a
  // subscription is when it pushes us a SUBSCRIPTION_* event. Record/refresh every
  // one here (charge AND lifecycle events) so the nightly poller has the full set of
  // subscription_ids to re-fetch. Best-effort: a registry failure (e.g. migration 031
  // not yet applied) must never change what we return to Cashfree.
  const subRec = extractCashfreeSubscription(payload);
  if (subRec) {
    try {
      const nowIso = new Date().toISOString();
      // Always-set keys; optional fields only when this event actually carries them, so a
      // payment/auth event (which has no plan/customer) never nulls-out the rich values a
      // prior STATUS_CHANGED wrote. onConflict updates only the keys present in this object.
      const row: Record<string, unknown> = {
        subscription_id: subRec.subscription_id,
        connector_id:    matched.id,
        org_id:          matched.org_id,
        last_event_type: subRec.event_type,
        last_event_at:   nowIso,
        raw:             subRec.raw as Database["public"]["Tables"]["cashfree_subscriptions"]["Row"]["raw"],
        updated_at:      nowIso,
      };
      const optional = {
        status: subRec.status, plan_name: subRec.plan_name, plan_amount: subRec.plan_amount,
        currency: subRec.currency, customer_name: subRec.customer_name,
        customer_email: subRec.customer_email, customer_phone: subRec.customer_phone,
        next_charge_at: subRec.next_charge_at,
      };
      for (const [k, v] of Object.entries(optional)) if (v != null) row[k] = v;
      await supabase
        .from("cashfree_subscriptions")
        .upsert(row as Database["public"]["Tables"]["cashfree_subscriptions"]["Insert"], { onConflict: "subscription_id,connector_id" });
    } catch (e) {
      console.error("[cashfree webhook] subscription registry upsert failed (non-fatal):", e);
    }
  }

  // Unified cross-gateway subscription model (subscriptions + subscription_events).
  // Additive alongside the legacy cashfree_subscriptions registry; non-fatal.
  try {
    const subResult = cashfreeSubscriptionAdapter(payload);
    if (subResult.subscription || subResult.events.length) {
      await persistSubscriptionResult(supabase, matched.org_id, matched.id, subResult);
    }
  } catch (e) {
    console.error("[cashfree webhook] unified subscription persist failed (non-fatal):", e);
  }

  const txn = normalizeCashfreeWebhookEvent(payload);
  if (!txn) {
    // Lifecycle-only subscription events carry no money — but we DID persist their
    // state to the registry above, so record that rather than a bare "ignored".
    await logWebhook(supabase, {
      outcome: subRec ? "persisted" : "ignored", signature_ok: true, event_type: payload?.type ?? null,
      connector_id: matched.id, org_id: matched.org_id,
      payload: subRec ? null : (payload as unknown as Database["public"]["Tables"]["webhook_events"]["Row"]["payload"]),
    });
    return NextResponse.json(
      subRec ? { received: true, subscription: subRec.subscription_id } : { received: true, ignored: payload?.type ?? "unknown" },
      { status: 200 }
    );
  }

  try {
    await persistTransactions(supabase, matched.org_id, matched.id, [txn]);
  } catch (err) {
    await logWebhook(supabase, {
      outcome: "persist_error", signature_ok: true, event_type: payload?.type ?? null,
      connector_id: matched.id, org_id: matched.org_id, external_id: txn.external_id ?? null,
      order_id: (txn.metadata as { order_id?: string })?.order_id ?? null, amount: txn.amount, status: txn.status,
      error: err instanceof Error ? err.message : String(err),
      payload: payload as unknown as Database["public"]["Tables"]["webhook_events"]["Row"]["payload"],
    });
    console.error(`[cashfree webhook] persist failed for ${payload?.type}:`, err);
    return NextResponse.json({ error: "Persist failed" }, { status: 500 });
  }

  await logWebhook(supabase, {
    outcome: "persisted", signature_ok: true, event_type: payload?.type ?? null,
    connector_id: matched.id, org_id: matched.org_id, external_id: txn.external_id ?? null,
    order_id: (txn.metadata as { order_id?: string })?.order_id ?? null, amount: txn.amount, status: txn.status,
  });
  return NextResponse.json({ received: true }, { status: 200 });
}
