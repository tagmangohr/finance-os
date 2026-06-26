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
      const data = await this.reconPage(fromDate, toDate, cursor);
      for (const ev of data.data ?? []) {
        const txn = normalizeCashfreeReconEvent(ev);
        if (txn) results.push(txn);
      }
      cursor = data.cursor ?? null;
    } while (cursor);

    return results;
  }

  /** One recon page, with backoff+jitter retry on transient failures. The recon
   *  endpoint returns 400 "internal_processing_error" (and 429/5xx) under concurrent
   *  load — these are transient, and the request is read-only/idempotent, so retrying
   *  with jittered backoff lets simultaneous calls (parallel jobs) succeed. */
  private async reconPage(
    fromDate: Date,
    toDate: Date,
    cursor: string | null
  ): Promise<{ data?: CashfreeReconEvent[]; cursor?: string | null }> {
    const MAX_RETRIES = 6;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${CASHFREE_BASE}/settlement/recon`, {
        method: "POST",
        headers: this.headers,
        next: { revalidate: 0 },
        body: JSON.stringify({
          pagination: { limit: PAGE_SIZE, cursor },
          filters: { start_date: fromDate.toISOString(), end_date: toDate.toISOString() },
        }),
      });
      if (res.ok) return res.json();

      const body = await res.text();
      const transient =
        res.status === 429 || res.status >= 500 || body.includes("internal_processing_error");
      if (transient && attempt < MAX_RETRIES) {
        // Capped exponential backoff + jitter. Capped at 5s so even 6 retries stay
        // well within the function budget, while the jitter de-synchronises the
        // concurrent jobs hitting recon so they stop colliding.
        const backoff = Math.min(600 * 2 ** attempt, 5000) + Math.floor(Math.random() * 600);
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }
      throw new Error(`Cashfree recon API error ${res.status}: ${body.slice(0, 200)}`);
    }
  }
}
