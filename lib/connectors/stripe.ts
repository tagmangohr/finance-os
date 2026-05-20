import Stripe from "stripe";
import {
  NormalizedTransaction,
  StripeCharge,
  StripePayout,
  normalizeStripeCharge,
  normalizeStripePayout,
} from "@/lib/normalizer";

export class StripeConnector {
  private stripe: Stripe;

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey, {
      apiVersion: "2025-02-24.acacia",
      typescript: true,
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
        expand: ["data.customer"],
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
