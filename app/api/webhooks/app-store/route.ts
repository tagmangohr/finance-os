import { NextRequest, NextResponse } from "next/server";
import { SignedDataVerifier, Environment } from "@apple/app-store-server-library";
import { createServiceClient } from "@/lib/supabase/server";
import { persistTransactions } from "@/lib/connectors/sync";
import { APPLE_ROOT_CERTIFICATES } from "@/lib/apple/root-ca";
import { normalizeAppStoreTransaction, type AppStoreTransactionInfo } from "@/lib/normalizer";
import type { Database, Json } from "@/lib/supabase/types";

export const runtime = "nodejs"; // Apple lib needs Node crypto + the cert store
export const maxDuration = 30;

type WebhookEventInsert = Database["public"]["Tables"]["webhook_events"]["Insert"];
type SupabaseLike = Awaited<ReturnType<typeof createServiceClient>>;

/**
 * Record one inbound App Store notification and its fate. Best-effort: a logging
 * failure must NEVER change what we return to Apple (see the Cashfree handler).
 * This is what lets us tell "Apple never sent it" apart from "we dropped it".
 */
async function logWebhook(
  supabase: SupabaseLike,
  row: Partial<WebhookEventInsert> & { outcome: WebhookEventInsert["outcome"]; signature_ok: boolean }
): Promise<void> {
  const full: WebhookEventInsert = {
    provider: "app_store",
    event_type: null, connector_id: null, org_id: null, external_id: null,
    order_id: null, amount: null, status: null, error: null, payload: null,
    ...row,
  };
  try {
    await supabase.from("webhook_events").insert(full);
  } catch (e) {
    console.error("[app-store webhook] event log insert failed (non-fatal):", e);
  }
}

/**
 * Read bundleId / environment / appAppleId from the notification's JWS WITHOUT
 * verifying it — used only to pick which connector (and which App Store
 * environment) to verify against. This decode is untrusted: the cryptographic
 * verification below (verifyAndDecodeNotification) is what actually proves the
 * payload came from Apple, so reading these fields early leaks no trust.
 */
function peekNotification(signedPayload: string): {
  bundleId: string | null; environment: string | null; appAppleId: number | null;
  notificationType: string | null; subtype: string | null;
} | null {
  try {
    const seg = signedPayload.split(".")[1];
    if (!seg) return null;
    const json = JSON.parse(Buffer.from(seg, "base64url").toString("utf8")) as {
      notificationType?: string; subtype?: string;
      data?: { bundleId?: string; environment?: string; appAppleId?: number };
    };
    return {
      bundleId: json.data?.bundleId ?? null,
      environment: json.data?.environment ?? null,
      appAppleId: json.data?.appAppleId ?? null,
      notificationType: json.notificationType ?? null,
      subtype: json.subtype ?? null,
    };
  } catch {
    return null;
  }
}

function toEnvironment(env: string | null): Environment {
  return env === "Production" ? Environment.PRODUCTION
    : env === "Xcode" ? Environment.XCODE
    : env === "LocalTesting" ? Environment.LOCAL_TESTING
    : Environment.SANDBOX;
}

/**
 * POST /api/webhooks/app-store — real-time App Store Server Notifications V2.
 *
 * Apple POSTs { "signedPayload": "<JWS>" }. The JWS is signed by Apple's cert
 * chain (x5c header) anchored to Apple Root CA G3 — there is NO shared secret, so
 * verification IS authentication. We peek the (unverified) bundleId to find the
 * matching `app_store` connector, then cryptographically verify + decode against
 * that connector's environment. Revenue is inside the nested signedTransactionInfo.
 *
 * Setup: App Store Connect → your app → App Information → App Store Server
 * Notifications → set the Production (and Sandbox) URL to this endpoint, V2 format.
 * Create an `app_store` connector with config { bundle_id, app_apple_id }.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const supabase = await createServiceClient();

  let signedPayload: string | undefined;
  try {
    signedPayload = (JSON.parse(rawBody) as { signedPayload?: string }).signedPayload;
  } catch {
    signedPayload = undefined;
  }
  if (!signedPayload) {
    await logWebhook(supabase, { outcome: "bad_json", signature_ok: false });
    return NextResponse.json({ error: "Missing signedPayload" }, { status: 400 });
  }

  const peek = peekNotification(signedPayload);
  if (!peek) {
    // Not even a decodable JWS — malformed request.
    await logWebhook(supabase, { outcome: "bad_json", signature_ok: false });
    return NextResponse.json({ error: "Malformed notification" }, { status: 400 });
  }
  if (!peek.bundleId) {
    // Valid JWS but no routable bundle (e.g. a summary/external-purchase
    // notification — no single transaction). Ack so Apple doesn't retry.
    await logWebhook(supabase, {
      outcome: "ignored", signature_ok: false,
      event_type: peek.subtype ? `${peek.notificationType}.${peek.subtype}` : peek.notificationType,
    });
    return NextResponse.json({ received: true, ignored: peek.notificationType ?? "no_bundle" }, { status: 200 });
  }

  // Match by bundle_id (an app can send to a shared URL, so we route on it).
  const { data: connectors } = await supabase
    .from("connectors")
    .select("id, org_id, config")
    .eq("type", "app_store")
    .eq("status", "active");

  const matched = (connectors ?? []).find((c) => {
    const cfg = (c.config ?? {}) as { bundle_id?: string };
    return cfg.bundle_id === peek.bundleId;
  }) as { id: string; org_id: string; config: { bundle_id?: string; app_apple_id?: number } } | undefined;

  const eventType = peek.subtype ? `${peek.notificationType}.${peek.subtype}` : peek.notificationType;

  if (!matched) {
    // No connector for this bundle yet. 200 so Apple doesn't hammer the endpoint;
    // the row here is the audit trail (backfill later via the Server API history).
    await logWebhook(supabase, {
      outcome: "unmatched", signature_ok: false, event_type: eventType,
      order_id: peek.bundleId,
    });
    return NextResponse.json({ received: true, unmatched: peek.bundleId }, { status: 200 });
  }

  // appAppleId is required to verify Production notifications, omitted in Sandbox.
  const environment = toEnvironment(peek.environment);
  const appAppleId = peek.appAppleId ?? matched.config.app_apple_id ?? undefined;
  const verifier = new SignedDataVerifier(
    APPLE_ROOT_CERTIFICATES,
    true, // enableOnlineChecks: verify cert expiry + revocation (Apple-recommended)
    environment,
    peek.bundleId,
    environment === Environment.PRODUCTION ? appAppleId : undefined
  );

  let payload: Awaited<ReturnType<SignedDataVerifier["verifyAndDecodeNotification"]>>;
  let txnInfo: AppStoreTransactionInfo | null = null;
  try {
    payload = await verifier.verifyAndDecodeNotification(signedPayload);
    const signedTxn = payload.data?.signedTransactionInfo;
    if (signedTxn) {
      txnInfo = (await verifier.verifyAndDecodeTransaction(signedTxn)) as AppStoreTransactionInfo;
    }
  } catch (err) {
    // Bad signature / broken chain / bundle mismatch, OR a transient OCSP failure.
    // 500 → Apple retries (recovers transient failures; forgeries aren't from Apple).
    await logWebhook(supabase, {
      outcome: "signature_failed", signature_ok: false, event_type: eventType,
      connector_id: matched.id, org_id: matched.org_id,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }

  const txn = txnInfo
    ? normalizeAppStoreTransaction(txnInfo, { notificationType: payload.notificationType, subtype: payload.subtype })
    : null;

  if (!txn) {
    // Verified, but lifecycle-only (no money moved) or no transaction attached.
    await logWebhook(supabase, {
      outcome: "ignored", signature_ok: true, event_type: eventType,
      connector_id: matched.id, org_id: matched.org_id,
      payload: (payload as unknown) as Json,
    });
    return NextResponse.json({ received: true, ignored: eventType }, { status: 200 });
  }

  try {
    await persistTransactions(supabase, matched.org_id, matched.id, [txn]);
  } catch (err) {
    await logWebhook(supabase, {
      outcome: "persist_error", signature_ok: true, event_type: eventType,
      connector_id: matched.id, org_id: matched.org_id, external_id: txn.external_id,
      order_id: txnInfo?.originalTransactionId ?? null, amount: txn.amount, status: txn.status,
      error: err instanceof Error ? err.message : String(err),
      payload: (payload as unknown) as Json,
    });
    console.error(`[app-store webhook] persist failed for ${eventType}:`, err);
    return NextResponse.json({ error: "Persist failed" }, { status: 500 });
  }

  await logWebhook(supabase, {
    outcome: "persisted", signature_ok: true, event_type: eventType,
    connector_id: matched.id, org_id: matched.org_id, external_id: txn.external_id,
    order_id: txnInfo?.originalTransactionId ?? null, amount: txn.amount, status: txn.status,
  });
  return NextResponse.json({ received: true }, { status: 200 });
}
