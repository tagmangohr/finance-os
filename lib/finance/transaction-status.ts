export const POSTED_TRANSACTION_STATUSES = ["completed", "refunded"];

/**
 * Bank-transfer rows: gateway payouts and settlements (source ends in
 * `_payout` / `_settlement`). These move money the gateway ALREADY recorded as
 * charges/payments into the merchant's bank — they are NOT income or expense.
 * They must be excluded from Net Flow, cash-flow outflow, and burn-rate, or a
 * Stripe payout (a debit) gets counted as money leaving and tanks Net Flow.
 */
export function isTransferSource(source: string | null | undefined): boolean {
  if (!source) return false;
  return source.endsWith("_payout") || source.endsWith("_settlement");
}

export type SourceBucket = "payment" | "refund" | "settlement" | "dispute" | "adjustment";

/**
 * Bucket a transaction `source` into a high-level category WITHOUT any per-gateway
 * hardcoding — driven by the naming convention every connector follows: the base
 * source (razorpay/stripe/cashfree/payu/…) is payments, and suffixed sources are
 * the special types (`_refund`, `_settlement`/`_payout`, `_dispute`, `_adjustment`).
 * New connectors are categorised automatically — no UI/summary edits per gateway.
 * (Same suffix approach as isTransferSource.)
 */
export function categorizeSource(source: string | null | undefined): SourceBucket {
  const s = (source ?? "").toLowerCase();
  if (s.endsWith("_settlement") || s.endsWith("_payout")) return "settlement";
  if (s.endsWith("_refund")) return "refund";
  if (s.endsWith("_dispute") || s.includes("chargeback")) return "dispute";
  if (s.endsWith("_adjustment")) return "adjustment";
  return "payment";
}

const GATEWAY_NAMES: Record<string, string> = {
  razorpay: "Razorpay", stripe: "Stripe", cashfree: "Cashfree",
  payu: "PayU", paytm: "Paytm", easebuzz: "Easebuzz",
  csv: "CSV", bank_statement: "Bank Statement", google_sheets: "Google Sheets", excel: "Excel",
};
const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);

/**
 * Human label for a source string, derived generically: "cashfree_refund" →
 * "Cashfree Refund", "stripe" → "Stripe". No per-gateway label table to maintain.
 */
export function sourceLabel(source: string | null | undefined): string {
  if (!source) return "—";
  // "app_store" is a two-word gateway (splitting on "_" would mangle it) and is
  // surfaced to users as "Apple Pay". Handle its prefix explicitly.
  if (source === "app_store" || source.startsWith("app_store_")) {
    const rest = source.slice("app_store".length).replace(/^_/, "");
    return rest ? `Apple Pay ${rest.split("_").map(cap).join(" ")}` : "Apple Pay";
  }
  const [gw, ...rest] = source.split("_");
  const gateway = GATEWAY_NAMES[gw] ?? cap(gw);
  return rest.length ? `${gateway} ${rest.map(cap).join(" ")}` : gateway;
}
