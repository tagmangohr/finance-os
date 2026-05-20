import {
  NormalizedTransaction,
  RazorpayPayment,
  RazorpayPayout,
  normalizeRazorpayPayment,
  normalizeRazorpayPayout,
} from "@/lib/normalizer";

const RAZORPAY_BASE = "https://api.razorpay.com/v1";
const PAGE_SIZE = 100;

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
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Razorpay API error ${res.status} for ${path}: ${body}`
      );
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

  async fetchPayouts(
    fromDate: Date,
    toDate: Date
  ): Promise<NormalizedTransaction[]> {
    const results: NormalizedTransaction[] = [];
    let cursor: string | undefined;

    while (true) {
      const params: Record<string, string | number> = {
        from: Math.floor(fromDate.getTime() / 1000),
        to: Math.floor(toDate.getTime() / 1000),
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

    return results;
  }

  // ─── Balance ──────────────────────────────────────────────────────────────

  async fetchBalance(): Promise<number> {
    const data = await this.get<{ balance: number }>("/balance", {});
    // Razorpay balance is in paise
    return data.balance / 100;
  }
}
