import {
  NormalizedTransaction,
  CashfreeReconEvent,
  normalizeCashfreeReconEvent,
} from "@/lib/normalizer";

const CASHFREE_BASE = "https://api.cashfree.com/pg";
const PAGE_SIZE = 1000; // recon API max
const API_VERSION = "2025-01-01";

/**
 * Cashfree Payment Gateway connector.
 *
 * IMPORTANT: the PG API has NO bulk "list orders/payments/settlements by date"
 * endpoint (the old GET /pg/orders|/settlements|/refunds calls 404). The only bulk
 * transaction feed is the Settlement Reconciliation report — POST /pg/settlement/recon
 * — which returns every money-movement event (payment/refund/dispute/chargeback) plus
 * settlement bookkeeping in a date range, cursor-paginated. Max 30 days per request
 * (callers already sub-chunk to ≤7 days, so that cap is never hit).
 */
export class CashfreeConnector {
  private headers: Record<string, string>;

  constructor(clientId: string, clientSecret: string) {
    this.headers = {
      "x-client-id": clientId,
      "x-client-secret": clientSecret,
      "x-api-version": API_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  async fetchReconEvents(fromDate: Date, toDate: Date): Promise<NormalizedTransaction[]> {
    const results: NormalizedTransaction[] = [];
    let cursor: string | null = null;

    do {
      const res = await fetch(`${CASHFREE_BASE}/settlement/recon`, {
        method: "POST",
        headers: this.headers,
        next: { revalidate: 0 },
        body: JSON.stringify({
          pagination: { limit: PAGE_SIZE, cursor },
          filters: { start_date: fromDate.toISOString(), end_date: toDate.toISOString() },
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Cashfree recon API error ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = (await res.json()) as { data?: CashfreeReconEvent[]; cursor?: string | null };
      for (const ev of data.data ?? []) {
        const txn = normalizeCashfreeReconEvent(ev);
        if (txn) results.push(txn);
      }
      cursor = data.cursor ?? null;
    } while (cursor);

    return results;
  }
}
