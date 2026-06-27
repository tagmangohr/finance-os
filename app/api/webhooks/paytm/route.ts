import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { persistTransactions } from "@/lib/connectors/sync";
import { decryptConfigSecrets } from "@/lib/crypto/secrets";
import { normalizePaytmTransaction, type PaytmTransaction } from "@/lib/normalizer";

export const maxDuration = 30;

const PAYTM_IV = "@@@@&&&&####$$$$";

/** Paytm param string: CHECKSUMHASH removed, keys sorted, values joined by "|",
 *  None/"null" → "" (faithful to Paytm's official PaytmChecksum.getStringByParams). */
function getStringByParams(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== "CHECKSUMHASH")
    .sort()
    .map((k) => {
      const v = params[k];
      return v == null || String(v).toLowerCase() === "null" ? "" : String(v);
    })
    .join("|");
}

/** Verify Paytm's checksum: AES-128-CBC-decrypt the hash → last 4 chars are the salt
 *  → recompute sha256(paramString|salt)+salt and compare. */
function verifyPaytmChecksum(params: Record<string, string>, merchantKey: string, checksum: string): boolean {
  try {
    const decipher = crypto.createDecipheriv("aes-128-cbc", Buffer.from(merchantKey, "utf8"), Buffer.from(PAYTM_IV, "utf8"));
    let paytmHash = decipher.update(checksum, "base64", "utf8");
    paytmHash += decipher.final("utf8");
    const salt = paytmHash.slice(-4);
    const calculated = crypto.createHash("sha256").update(`${getStringByParams(params)}|${salt}`).digest("hex") + salt;
    const a = Buffer.from(calculated);
    const b = Buffer.from(paytmHash);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false; // bad key length / corrupt checksum
  }
}

/**
 * POST /api/webhooks/paytm — real-time Paytm transaction ingestion.
 *
 * ⚠️ UNVERIFIED: Paytm is a stub connector (no working sync / live credentials), so
 * this is implemented faithfully to Paytm's official checksum algorithm but NOT
 * tested against a real Paytm callback. Validate against a live webhook before
 * production use.
 *
 * Paytm posts FORM-ENCODED uppercase params + CHECKSUMHASH, verified via AES-128-CBC
 * (IV @@@@&&&&####$$$$) + sha256/salt using the merchant key. Match the connector by
 * the public MID, verify with its decrypted merchant_key. Idempotent persist.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody)) as Record<string, string>;

  const mid = params.MID ?? "";
  const checksum = params.CHECKSUMHASH ?? "";
  if (!mid || !checksum) {
    return NextResponse.json({ error: "Missing MID/CHECKSUMHASH" }, { status: 400 });
  }

  const supabase = await createServiceClient();
  const { data: connectors } = await supabase
    .from("connectors")
    .select("id, org_id, config")
    .eq("type", "paytm")
    .eq("status", "active");

  const conn = (connectors ?? []).find((c) => (c.config as Record<string, string>)?.merchant_id === mid);
  if (!conn) {
    return NextResponse.json({ received: true, unmatched: true }, { status: 200 });
  }
  const merchantKey = decryptConfigSecrets((conn.config ?? {}) as Record<string, string>).merchant_key;
  if (!merchantKey) {
    console.error("[paytm webhook] connector missing merchant_key");
    return NextResponse.json({ error: "Connector misconfigured" }, { status: 500 });
  }

  if (!verifyPaytmChecksum(params, merchantKey, checksum)) {
    return NextResponse.json({ error: "Invalid checksum" }, { status: 401 });
  }

  // Map Paytm's uppercase callback params to the normalizer's shape.
  const paytmTxn: PaytmTransaction = {
    orderId: params.ORDERID ?? "",
    txnId: params.TXNID ?? null,
    txnAmount: params.TXNAMOUNT ?? "",
    txnDate: params.TXNDATE ?? "",
    status: params.STATUS ?? "",
    paymentMode: params.PAYMENTMODE ?? params.GATEWAYNAME ?? null,
    bankTxnId: params.BANKTXNID ?? null,
    bankName: params.BANKNAME ?? null,
    custId: params.CUSTID ?? null,
    responseCode: params.RESPCODE ?? null,
    responseMsg: params.RESPMSG ?? null,
  };

  try {
    await persistTransactions(supabase, conn.org_id, conn.id, [normalizePaytmTransaction(paytmTxn)]);
  } catch (err) {
    console.error("[paytm webhook] persist failed:", err);
    return NextResponse.json({ error: "Persist failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true }, { status: 200 });
}
