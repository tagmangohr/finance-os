import {
  NormalizedTransaction,
  CashfreeOrder,
  CashfreeSettlement,
  CashfreeRefund,
  normalizeCashfreeOrder,
  normalizeCashfreeSettlement,
  normalizeCashfreeRefund,
} from "@/lib/normalizer";

const CASHFREE_BASE = "https://api.cashfree.com/pg";
const PAGE_SIZE = 50;

export class CashfreeConnector {
  private headers: Record<string, string>;

  constructor(clientId: string, clientSecret: string) {
    this.headers = {
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
      "x-api-version": "2023-08-01",
      "Content-Type": "application/json",
    };
  }

  // ─── Internal GET helper ──────────────────────────────────────────────────

  private async get<T>(
    path: string,
    params: Record<string, string | number>
  ): Promise<T> {
    const url = new URL(`${CASHFREE_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }

    const res = await fetch(url.toString(), {
      headers: this.headers,
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Cashfree API error ${res.status} for ${path}: ${body}`);
    }

    return res.json() as Promise<T>;
  }

  // ─── Orders (credits) ─────────────────────────────────────────────────────

  async fetchOrders(
    fromDate: Date,
    toDate: Date
  ): Promise<NormalizedTransaction[]> {
    const results: NormalizedTransaction[] = [];
    let cursor: string | undefined;

    while (true) {
      const params: Record<string, string | number> = {
        from_date: fromDate.toISOString().split("T")[0],
        to_date: toDate.toISOString().split("T")[0],
        count: PAGE_SIZE,
      };
      if (cursor) params.cursor = cursor;

      const data = await this.get<{
        orders?: CashfreeOrder[];
        cursor?: string;
      }>("/orders", params);

      const items = data.orders ?? [];
      for (const order of items) {
        results.push(normalizeCashfreeOrder(order));
      }

      if (items.length < PAGE_SIZE || !data.cursor) break;
      cursor = data.cursor;
    }

    return results;
  }

  // ─── Settlements (credits) ────────────────────────────────────────────────

  async fetchSettlements(
    fromDate: Date,
    toDate: Date
  ): Promise<NormalizedTransaction[]> {
    const results: NormalizedTransaction[] = [];
    let cursor: string | undefined;

    while (true) {
      const params: Record<string, string | number> = {
        from_date: fromDate.toISOString().split("T")[0],
        to_date: toDate.toISOString().split("T")[0],
        count: PAGE_SIZE,
      };
      if (cursor) params.cursor = cursor;

      const data = await this.get<{
        settlements?: CashfreeSettlement[];
        cursor?: string;
      }>("/settlements", params);

      const items = data.settlements ?? [];
      for (const s of items) {
        results.push(normalizeCashfreeSettlement(s));
      }

      if (items.length < PAGE_SIZE || !data.cursor) break;
      cursor = data.cursor;
    }

    return results;
  }

  // ─── Refunds (debits) ─────────────────────────────────────────────────────

  async fetchRefunds(
    fromDate: Date,
    toDate: Date
  ): Promise<NormalizedTransaction[]> {
    const results: NormalizedTransaction[] = [];
    let cursor: string | undefined;

    while (true) {
      const params: Record<string, string | number> = {
        from_date: fromDate.toISOString().split("T")[0],
        to_date: toDate.toISOString().split("T")[0],
        count: PAGE_SIZE,
      };
      if (cursor) params.cursor = cursor;

      const data = await this.get<{
        refunds?: CashfreeRefund[];
        cursor?: string;
      }>("/refunds", params);

      const items = data.refunds ?? [];
      for (const r of items) {
        results.push(normalizeCashfreeRefund(r));
      }

      if (items.length < PAGE_SIZE || !data.cursor) break;
      cursor = data.cursor;
    }

    return results;
  }
}
