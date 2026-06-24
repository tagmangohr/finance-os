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
