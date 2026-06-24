import Stripe from "stripe";
import {
  NormalizedTransaction,
  StripeCharge,
  StripePayout,
  StripeDispute,
  normalizeStripeCharge,
  normalizeStripePayout,
  normalizeStripeDispute,
} from "@/lib/normalizer";

export class StripeConnector {
  private stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey, {
      apiVersion: "2025-02-24.acacia",
      typescript: true,
      // Per-request timeout (well under the 60 s function budget) so a single
      // hung socket can't eat the whole sync; combined with built-in
      // exponential backoff this absorbs transient 429/5xx without manual code.
      timeout: 20000,
      maxNetworkRetries: 2,
    });
  }

  // ─── Charges ──────────────────────────────────────────────────────────────

  async fetchCharges(
    fromDate: Date,
    toDate: Date
  ): Promise<NormalizedTransaction[]> {
    const results: NormalizedTransaction[] = [];
    let startingAfter: string | undefined;

    while (true) {
      const params: Stripe.ChargeListParams = {
        created: {
          gte: Math.floor(fromDate.getTime() / 1000),
          lte: Math.floor(toDate.getTime() / 1000),
        },
        limit: 100,
        // No expands. balance_transaction was tried for FX but this account
        // settles in USD (no INR there) so it added per-page latency for nothing
        // — INR now comes from ECB rates (lib/fx). data.customer is also avoided;
        // billing_details (inline) covers the counterparty name. Keeping pages
        // lean is what keeps each backfill job under the function timeout.
      };
      if (startingAfter) params.starting_after = startingAfter;

      const page = await this.stripe.charges.list(params);

      for (const charge of page.data) {
        results.push(normalizeStripeCharge(charge as unknown as StripeCharge));
      }

      if (!page.has_more || page.data.length === 0) break;
      startingAfter = page.data[page.data.length - 1].id;
    }

    return results;
  }

  // ─── Payouts ──────────────────────────────────────────────────────────────

  async fetchPayouts(
    fromDate: Date,
    toDate: Date
  ): Promise<NormalizedTransaction[]> {
    const results: NormalizedTransaction[] = [];
    let startingAfter: string | undefined;

    while (true) {
      const params: Stripe.PayoutListParams = {
        created: {
          gte: Math.floor(fromDate.getTime() / 1000),
          lte: Math.floor(toDate.getTime() / 1000),
        },
        limit: 100,
      };
      if (startingAfter) params.starting_after = startingAfter;

      const page = await this.stripe.payouts.list(params);

      for (const payout of page.data) {
        results.push(
          normalizeStripePayout(payout as unknown as StripePayout)
        );
      }

      if (!page.has_more || page.data.length === 0) break;
      startingAfter = page.data[page.data.length - 1].id;
    }

    return results;
  }

  // ─── Resumable chunked fetch ────────────────────────────────────────────────
  // Fetches ONE time-bounded chunk of a stream from a cursor (starting_after).
  // Returns the rows plus a resume cursor + hasMore, so the caller can persist
  // and continue on the next invocation. This is what makes high-volume sync
  // unbreakable: each call is bounded by the deadline, never the data size, and
  // the cursor only moves forward so every record is fetched exactly once.

  async fetchChunk(
    stream: "charges" | "payouts" | "disputes",
    opts: { gteSec: number; lteSec: number; startingAfter: string | null; deadlineMs: number }
  ): Promise<{ transactions: NormalizedTransaction[]; nextCursor: string | null; hasMore: boolean }> {
    const results: NormalizedTransaction[] = [];
    const created = { gte: opts.gteSec, lte: opts.lteSec };
    let startingAfter = opts.startingAfter ?? undefined;
    let hasMore = true;

    while (Date.now() < opts.deadlineMs) {
      const params = { created, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) };
      const page =
        stream === "charges"
          ? await this.stripe.charges.list(params as Stripe.ChargeListParams)
          : stream === "payouts"
          ? await this.stripe.payouts.list(params as Stripe.PayoutListParams)
          : await this.stripe.disputes.list(params as Stripe.DisputeListParams);

      for (const item of page.data) {
        results.push(
          stream === "charges"
            ? normalizeStripeCharge(item as unknown as StripeCharge)
            : stream === "payouts"
            ? normalizeStripePayout(item as unknown as StripePayout)
            : normalizeStripeDispute(item as unknown as StripeDispute)
        );
      }

      if (!page.has_more || page.data.length === 0) {
        hasMore = false;
        break;
      }
      startingAfter = page.data[page.data.length - 1].id;
    }

    return { transactions: results, nextCursor: startingAfter ?? null, hasMore };
  }

  // ─── Balance ──────────────────────────────────────────────────────────────

  async fetchBalance(): Promise<number> {
    const balance = await this.stripe.balance.retrieve();

    // Sum available amounts across all currencies, convert to full units
    // Return the INR equivalent if present; otherwise sum all available
    const available = balance.available;
    const inr = available.find((b) => b.currency === "inr");
    if (inr) return inr.amount / 100;

    // Fallback: return first available balance in full units
    if (available.length > 0) {
      const first = available[0];
      // Zero-decimal currencies
      const ZERO_DECIMAL = new Set([
        "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga",
        "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
      ]);
      return ZERO_DECIMAL.has(first.currency) ? first.amount : first.amount / 100;
    }

    return 0;
  }
}
