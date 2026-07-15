import {
  NormalizedTransaction,
  CashfreeReconEvent,
  normalizeCashfreeReconEvent,
} from "@/lib/normalizer";

const CASHFREE_BASE = "https://api.cashfree.com/pg";
const PAGE_SIZE = 1000; // recon API max
const API_VERSION = "2025-01-01";
const DAY_MS = 24 * 60 * 60 * 1000;
// recon caps each request at 30 days, but for this merchant's data the endpoint's
// intermittent "internal_processing_error" trips FAR more often on large (25–30 day)
// windows than on ~10-day ones (verified empirically: 25-day windows fail where
// consecutive 10–12 day windows succeed). Smaller windows also keep a single
// (non-resumable) recon job well under the function time budget.
const WINDOW_MS = 10 * DAY_MS;
// Full re-paginations of a window before giving up ON THIS RUN (see fetchWindow).
const WINDOW_ATTEMPTS = 5;

/**
 * Cashfree Payment Gateway connector.
 *
 * The PG API has NO bulk "list orders/payments by date" endpoint — the only bulk
 * transaction feed is the Settlement Reconciliation report (POST /pg/settlement/recon),
 * cursor-paginated, ≤30 days per request, returning every money event
 * (payment/refund/dispute/chargeback/settlement).
 *
 * Reliability reality: this endpoint intermittently returns a 400
 * "internal_processing_error" (Cashfree server-side, flaky for this merchant's data).
 * We run it as ONE sequential chain (it returns short results under concurrent
 * pagination — enqueued as a single whole-range job), retry each window from scratch,
 * and on persistent failure keep every other window and move on. Idempotent nightly
 * re-syncs accumulate the union as Cashfree recovers.
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
    const end = toDate.getTime();
    // UTC-midnight-aligned 30-day windows, walked sequentially (single recon chain).
    const start = Math.round(fromDate.getTime() / DAY_MS) * DAY_MS;
    for (let cur = start; cur < end; cur += WINDOW_MS) {
      const windowFrom = new Date(cur);
      const windowTo = new Date(Math.min(cur + WINDOW_MS, end));
      results.push(...(await this.fetchWindow(windowFrom, windowTo)));
    }
    return results;
  }

  /**
   * Paginate one ≤30-day window. Cashfree's recon error can strike mid-pagination,
   * and re-requesting the SAME cursor keeps failing — so on any failure we restart
   * the WHOLE window from a fresh cursor. After WINDOW_ATTEMPTS we give up on this
   * window for this run (returning the other windows intact, never aborting the
   * sync); a later sync re-fetches it (dedup makes that free).
   */
  private async fetchWindow(from: Date, to: Date): Promise<NormalizedTransaction[]> {
    for (let attempt = 1; attempt <= WINDOW_ATTEMPTS; attempt++) {
      try {
        const out: NormalizedTransaction[] = [];
        let cursor: string | null = null;
        do {
          const res = await fetch(`${CASHFREE_BASE}/settlement/recon`, {
            method: "POST",
            headers: this.headers,
            next: { revalidate: 0 },
            body: JSON.stringify({
              pagination: { limit: PAGE_SIZE, cursor },
              filters: { start_date: from.toISOString(), end_date: to.toISOString() },
            }),
          });
          if (!res.ok) {
            const body = await res.text();
            throw new Error(`Cashfree recon ${res.status}: ${body.slice(0, 160)}`);
          }
          const data = (await res.json()) as { data?: CashfreeReconEvent[]; cursor?: string | null };
          for (const ev of data.data ?? []) {
            const txn = normalizeCashfreeReconEvent(ev);
            if (txn) out.push(txn);
          }
          cursor = data.cursor ?? null;
        } while (cursor);
        return out; // window fully paginated
      } catch (err) {
        if (attempt < WINDOW_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 800 * attempt + Math.floor(Math.random() * 600)));
          continue;
        }
        // Cashfree's recon is erroring on this window right now; keep the others and
        // let the next sync pick it up. (Idempotent — re-fetching costs nothing.)
        console.error(
          `[cashfree] recon window ${from.toISOString().slice(0, 10)}..${to.toISOString().slice(0, 10)} ` +
          `unavailable after ${WINDOW_ATTEMPTS} attempts (Cashfree internal_processing_error); other windows kept, will retry next sync:`,
          err
        );
        return [];
      }
    }
    return [];
  }
}
