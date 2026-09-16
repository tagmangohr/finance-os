import crypto from "crypto";

/**
 * The outbound webhook `v1` contract — the ONE place that shapes a transaction
 * snapshot into the payload and signs it. Both the delivery worker and the "send
 * test" route go through here, so what we document is exactly what we send.
 *
 * Signature: HMAC-SHA256 over "<t>.<rawBody>" with the endpoint's secret, sent as
 *   X-FinanceOS-Signature: t=<unix>,v1=<hex>
 * The receiver recomputes it, constant-time compares v1, and rejects if
 * |now - t| > tolerance (default 5 min) to stop replay.
 */

export const WEBHOOK_API_VERSION = "v1";

export type WebhookEventType = "payment.created" | "payment.updated" | "payment.refunded";

type TxSnapshot = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface WebhookPayload {
  id: string;                 // event id — stable dedupe key
  type: WebhookEventType;
  api_version: string;
  created: string;            // ISO — when we emitted this delivery
  org_id: string;
  data: {
    transaction_id: string | null;
    external_id: string | null;   // gateway's own id
    gateway: string | null;       // transactions.source (razorpay/stripe/…)
    status: string | null;        // completed | refunded | failed | pending
    amount: number | null;        // original currency
    currency: string | null;
    amount_inr: number | null;    // amount_base
    fee: number | null;           // metadata.fee, when known
    category: string | null;
    transaction_date: string | null;
    transaction_at: string | null;
    customer: { name: string | null; email: string | null; phone: string | null };
    subscription_id: string | null;
    description: string | null;
  };
}

/** Shape a stored tx snapshot (to_jsonb(row) - 'raw') into the v1 payload. Only the
 *  whitelisted fields ever leave — internal columns in the snapshot are dropped. */
export function buildWebhookPayload(opts: {
  eventId: string;
  eventType: WebhookEventType;
  orgId: string;
  snapshot: TxSnapshot;
  createdAt?: Date;
}): WebhookPayload {
  const t = opts.snapshot ?? {};
  const meta = (t.metadata && typeof t.metadata === "object" ? t.metadata : {}) as Record<string, unknown>;
  return {
    id: opts.eventId,
    type: opts.eventType,
    api_version: WEBHOOK_API_VERSION,
    created: (opts.createdAt ?? new Date()).toISOString(),
    org_id: opts.orgId,
    data: {
      transaction_id: str(t.id),
      external_id: str(t.external_id),
      gateway: str(t.source),
      status: str(t.status),
      amount: num(t.amount),
      currency: str(t.currency),
      amount_inr: num(t.amount_base),
      fee: num(meta.fee),
      category: str(t.category),
      transaction_date: str(t.transaction_date),
      transaction_at: str(t.transaction_at),
      customer: { name: str(t.counterparty_name), email: str(meta.email), phone: str(meta.phone) },
      subscription_id: str(t.subscription_id),
      description: str(t.description),
    },
  };
}

/** Sign a raw JSON body. Returns the header value + parts for logging/tests. */
export function signWebhookBody(secret: string, body: string, tSeconds?: number): {
  t: number; v1: string; header: string;
} {
  const t = tSeconds ?? Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return { t, v1, header: `t=${t},v1=${v1}` };
}

/** Verify a signature (exported for our own tests / a reference receiver impl). */
export function verifyWebhookSignature(secret: string, body: string, header: string, toleranceSec = 300): boolean {
  const m = /(?:^|,)\s*t=(\d+)/.exec(header);
  const s = /(?:^|,)\s*v1=([0-9a-f]+)/i.exec(header);
  if (!m || !s) return false;
  const t = Number(m[1]);
  if (!Number.isFinite(t) || Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(s[1], "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
