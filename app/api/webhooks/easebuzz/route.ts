import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { connectorByToken } from "@/lib/connectors/webhook-connector";
import { persistTransactions } from "@/lib/connectors/sync";
import { captureEvent } from "@/lib/events/capture";
import { decryptConfigSecrets } from "@/lib/crypto/secrets";
import { normalizeEasebuzzTransaction, type EasebuzzTransaction } from "@/lib/normalizer";

export const maxDuration = 30;

/**
 * POST /api/webhooks/easebuzz — real-time Easebuzz transaction ingestion.
 *
 * ⚠️ UNVERIFIED: Easebuzz is a stub connector (no working sync / live credentials),
 * so this is implemented per Easebuzz's documented reverse-hash but NOT tested
 * against a real webhook. Validate against a live event before production use.
 *
 * Easebuzz (PayU-derived) posts FORM-ENCODED params + a reverse SHA-512 hash:
 *   sha512(salt|status|udf10|…|udf1|email|firstname|productinfo|amount|txnid|key)
 * Match the connector by the public `key`, verify with its decrypted salt, normalize
 * via normalizeEasebuzzTransaction, persist (idempotent).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody)) as Record<string, string>;

  const key = params.key ?? "";
  const providedHash = (params.hash ?? "").toLowerCase();
  if (!key || !providedHash) {
    return NextResponse.json({ error: "Missing key/hash" }, { status: 400 });
  }

  const supabase = await createServiceClient();
  const { data: connectors } = await supabase
    .from("connectors")
    .select("id, org_id, config")
    .eq("type", "easebuzz")
    .eq("status", "active");

  // Prefer the token-pinned connector (?c=<token>); else match by public key.
  const tokenConn = await connectorByToken(supabase, "easebuzz", req.nextUrl.searchParams.get("c"));
  const conn = tokenConn
    ? { id: tokenConn.id, org_id: tokenConn.org_id, config: tokenConn.config }
    : (connectors ?? []).find((c) => (c.config as Record<string, string>)?.key === key);
  if (!conn) {
    return NextResponse.json({ received: true, unmatched: true }, { status: 200 });
  }
  const salt = decryptConfigSecrets((conn.config ?? {}) as Record<string, string>).salt;
  if (!salt) {
    console.error("[easebuzz webhook] connector missing salt");
    return NextResponse.json({ error: "Connector misconfigured" }, { status: 500 });
  }

  const udf = (n: number) => params[`udf${n}`] ?? "";
  const hashStr = [
    salt, params.status ?? "",
    udf(10), udf(9), udf(8), udf(7), udf(6), udf(5), udf(4), udf(3), udf(2), udf(1),
    params.email ?? "", params.firstname ?? "", params.productinfo ?? "",
    params.amount ?? "", params.txnid ?? "", key,
  ].join("|");
  const expected = crypto.createHash("sha512").update(hashStr).digest("hex");
  const a = Buffer.from(providedHash);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Invalid hash" }, { status: 401 });
  }

  // Durable archive of the raw event (no-op unless capture is enabled for this connector).
  await captureEvent(supabase, {
    provider: "easebuzz", connectorId: conn.id, orgId: conn.org_id,
    eventType: params.status ?? null, eventId: params.easepayid ?? params.txnid ?? null,
    signatureOk: true, payload: params,
  });

  try {
    await persistTransactions(supabase, conn.org_id, conn.id, [
      normalizeEasebuzzTransaction(params as unknown as EasebuzzTransaction),
    ]);
  } catch (err) {
    console.error("[easebuzz webhook] persist failed:", err);
    return NextResponse.json({ error: "Persist failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
