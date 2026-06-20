import {
  NormalizedTransaction,
  RazorpayPayment,
  RazorpayPayout,
  RazorpayRefund,
  RazorpaySettlement,
  RazorpayDispute,
  normalizeRazorpayPayment,
  normalizeRazorpayPayout,
  normalizeRazorpayRefund,
  normalizeRazorpaySettlement,
  normalizeRazorpayDispute,
} from "@/lib/normalizer";

const RAZORPAY_BASE = "https://api.razorpay.com/v1";
const PAGE_SIZE = 100;

/**
 * Thrown by the internal fetch helper so callers can branch on the HTTP status
 * — e.g. treat a 4xx on the OPTIONAL payouts endpoint as "feature unavailable"
 * rather than a hard sync failure.
 */
export class RazorpayApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string
  ) {
    super(`Razorpay API error ${status} for ${path}: ${body}`);
    this.name = "RazorpayApiError";
  }
}

export class RazorpayConnector {
  private authHeader: string;

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string
  ) {
    this.authHeader =
      "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  }

  // ─── Internal fetch helper ─────────────────────────────────────────────────

  private async get<T>(
    path: string,
    params: Record<string, string | number>
  ): Promise<T> {
    const url = new URL(`${RAZORPAY_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
      },
      // Hard timeout — prevents a slow Razorpay response from eating the
      // entire Vercel function budget (10 s on Hobby, 60 s on Pro).
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new RazorpayApiError(res.status, path, body);
    }

    return res.json() as Promise<T>;
  }

  // ─── Payments ─────────────────────────────────────────────────────────────

  async fetchPayments(
    fromDate: Date,
    toDate: Date
  ): Promise<NormalizedTransaction[]> {
    const results: NormalizedTransaction[] = [];
    let skip = 0;

    while (true) {
      const data = await this.get<{ items: RazorpayPayment[]; count: number }>(
        "/payments",
        {
          from: Math.floor(fromDate.getTime() / 1000),
          to: Math.floor(toDate.getTime() / 1000),
          count: PAGE_SIZE,
          skip,
        }
      );

      const items: RazorpayPayment[] = data.items ?? [];
      for (const payment of items) {
        results.push(normalizeRazorpayPayment(payment));
      }

      if (items.length < PAGE_SIZE) break;
      skip += PAGE_SIZE;
    }

    return results;
  }

  // ─── Payouts ──────────────────────────────────────────────────────────────
  // Payouts is an OPTIONAL, Razorpay X-only feature (Razorpay's banking product).
  // The /payouts API requires an account_number param, and that number must be a
  // valid Razorpay X virtual account number. Because it is optional, it must NEVER
  // break or distort the core payments sync:
  //   • No account number       → don't touch the API at all (return []).
  //   • Account number set but   → the API 4xx's (not a Razorpay X account, wrong
  //     Razorpay X not enabled /   number, or no permission). Swallow it and return
  //     invalid / unpermissioned   [] so the sync still succeeds with honest counts.
  // Genuine transient/server errors (5xx, timeout) still propagate so a real
  // outage is surfaced and can be retried.

  async fetchPayouts(
    fromDate: Date,
    toDate: Date,
    accountNumber?: string
  ): Promise<NormalizedTransaction[]> {
    // Optional field absent → never hit the server.
    if (!accountNumber || !accountNumber.trim()) return [];

    const results: NormalizedTransaction[] = [];
    let cursor: string | undefined;

    try {
      while (true) {
        const params: Record<string, string | number> = {
          account_number: accountNumber.trim(),
          from: Math.floor(fromDate.getTime() / 1000),
          to:   Math.floor(toDate.getTime() / 1000),
          count: PAGE_SIZE,
        };
        if (cursor) params.cursor = cursor;

        const data = await this.get<{
          items: RazorpayPayout[];
          count: number;
          cursor?: string;
        }>("/payouts", params);

        const items: RazorpayPayout[] = data.items ?? [];
        for (const payout of items) {
          results.push(normalizeRazorpayPayout(payout));
        }

        if (items.length < PAGE_SIZE || !data.cursor) break;
        cursor = data.cursor;
      }
    } catch (err) {
      // A 4xx means payouts simply aren't available for this account (no Razorpay X,
      // wrong/invalid account number, or missing permission). It's an optional
      // feature, so skip it silently — return whatever we paged in so far rather
      // than failing the whole sync or emitting a misleading warning.
      if (
        err instanceof RazorpayApiError &&
        err.status >= 400 &&
        err.status < 500
      ) {
        return results;
      }
      throw err;
    }

    return results;
  }

  // ─── Refunds ─────────────────────────────────────────────────────────────

  async fetchRefunds(
    fromDate: Date,
    toDate: Date
  ): Promise<NormalizedTransaction[]> {
    const results: NormalizedTransaction[] = [];
    let skip = 0;

    while (true) {
      const data = await this.get<{ items: RazorpayRefund[]; count: number }>(
        "/refunds",
        {
          from: Math.floor(fromDate.getTime() / 1000),
          to: Math.floor(toDate.getTime() / 1000),
          count: PAGE_SIZE,
          skip,
        }
      );

      const items: RazorpayRefund[] = data.items ?? [];
      for (const refund of items) {
        results.push(normalizeRazorpayRefund(refund));
      }

      if (items.length < PAGE_SIZE) break;
      skip += PAGE_SIZE;
    }

    return results;
  }

  // ─── Settlements ──────────────────────────────────────────────────────────

  async fetchSettlements(
    fromDate: Date,
    toDate: Date
  ): Promise<NormalizedTransaction[]> {
    const results: NormalizedTransaction[] = [];
    let skip = 0;

    while (true) {
      const data = await this.get<{ items: RazorpaySettlement[]; count: number }>(
        "/settlements",
        {
          from: Math.floor(fromDate.getTime() / 1000),
          to: Math.floor(toDate.getTime() / 1000),
          count: PAGE_SIZE,
          skip,
        }
      );

      const items: RazorpaySettlement[] = data.items ?? [];
      for (const settlement of items) {
        results.push(normalizeRazorpaySettlement(settlement));
      }

      if (items.length < PAGE_SIZE) break;
      skip += PAGE_SIZE;
    }

    return results;
  }

  // ─── Disputes / Chargebacks ───────────────────────────────────────────────

  async fetchDisputes(
    fromDate: Date,
    toDate: Date
  ): Promise<NormalizedTransaction[]> {
    const results: NormalizedTransaction[] = [];
    let skip = 0;

    while (true) {
      const data = await this.get<{ items: RazorpayDispute[]; count: number }>(
        "/disputes",
        {
          from: Math.floor(fromDate.getTime() / 1000),
          to: Math.floor(toDate.getTime() / 1000),
          count: PAGE_SIZE,
          skip,
        }
      );

      const items: RazorpayDispute[] = data.items ?? [];
      for (const dispute of items) {
        results.push(normalizeRazorpayDispute(dispute));
      }

      if (items.length < PAGE_SIZE) break;
      skip += PAGE_SIZE;
    }

    return results;
  }

  // ─── Balance ──────────────────────────────────────────────────────────────

  async fetchBalance(): Promise<number> {
    const data = await this.get<{ balance: number }>("/balance", {});
    // Razorpay balance is in paise
    return data.balance / 100;
  }
}
