import {
  NormalizedTransaction,
  CashfreeReconEvent,
  CashfreeSubscriptionApiPayment,
  normalizeCashfreeReconEvent,
  normalizeCashfreeSubscriptionApiPayment,
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
/**
 * Pure extraction of chargeback fees from raw recon events — shared by the connector's
 * fetchReconDisputeFees and any caller that already holds the raw feed (so the flaky
 * recon endpoint isn't paginated twice). Keeps non-zero fees of EITHER sign so a fee
 * charged on the chargeback and (rarely) reversed on a win net out per order downstream.
 */
export function extractCashfreeDisputeFees(
  events: CashfreeReconEvent[]
): { orderId: string | null; cfPaymentId: string | null; fee: number; when: string | null }[] {
  const out: { orderId: string | null; cfPaymentId: string | null; fee: number; when: string | null }[] = [];
  for (const ev of events) {
    const type = (ev.event_details?.event_type ?? "").toUpperCase();
    if (!(type.includes("DISPUTE") || type.includes("CHARGEBACK") || type === "PRE_ARBITRATION")) continue;
    const fee =
      Number(ev.event_details?.event_service_charge ?? 0) +
      Number(ev.event_details?.event_service_tax ?? 0);
    if (!Number.isFinite(fee) || fee === 0) continue;
    out.push({
      orderId: ev.order_details?.order_id ?? null,
      cfPaymentId: ev.payment_details?.cf_payment_id != null ? String(ev.payment_details.cf_payment_id) : null,
      fee,
      when: ev.event_details?.event_time ?? null,
    });
  }
  return out;
}

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
      for (const ev of await this.fetchWindowRaw(windowFrom, windowTo)) {
        const txn = normalizeCashfreeReconEvent(ev);
        if (txn) results.push(txn);
      }
    }
    return results;
  }

  /**
   * The raw recon events over a window — the single source both the payment-fee and
   * the dispute-fee reconcile passes read (fetch once, derive both), so the flaky
   * recon endpoint is paginated only once per night.
   */
  async fetchReconRaw(fromDate: Date, toDate: Date): Promise<CashfreeReconEvent[]> {
    const out: CashfreeReconEvent[] = [];
    const end = toDate.getTime();
    const start = Math.round(fromDate.getTime() / DAY_MS) * DAY_MS;
    for (let cur = start; cur < end; cur += WINDOW_MS) {
      out.push(...(await this.fetchWindowRaw(new Date(cur), new Date(Math.min(cur + WINDOW_MS, end)))));
    }
    return out;
  }

  /**
   * Dispute/chargeback FEES from the recon feed. The normalizer deliberately DROPS
   * dispute/chargeback events (they'd duplicate the webhook-owned dispute rows, which
   * carry a stable dispute_id recon lacks) — but those events are the ONLY source of
   * the chargeback fee (event_service_charge + event_service_tax). So we read the raw
   * events directly here and return the fee keyed by order_id / cf_payment_id, for a
   * fill-only reconcile pass to stamp onto the existing dispute rows (never a new row).
   * All INR. Same resilient windowed fetch as the payment feed.
   */
  async fetchReconDisputeFees(
    fromDate: Date,
    toDate: Date
  ): Promise<{ orderId: string | null; cfPaymentId: string | null; fee: number; when: string | null }[]> {
    return extractCashfreeDisputeFees(await this.fetchReconRaw(fromDate, toDate));
  }

  /**
   * Paginate one ≤30-day window and return the RAW recon events. Cashfree's recon
   * error can strike mid-pagination, and re-requesting the SAME cursor keeps failing —
   * so on any failure we restart the WHOLE window from a fresh cursor. After
   * WINDOW_ATTEMPTS we give up on this window for this run (returning the other windows
   * intact, never aborting the sync); a later sync re-fetches it (dedup makes that free).
   */
  private async fetchWindowRaw(from: Date, to: Date): Promise<CashfreeReconEvent[]> {
    for (let attempt = 1; attempt <= WINDOW_ATTEMPTS; attempt++) {
      try {
        const out: CashfreeReconEvent[] = [];
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
          for (const ev of data.data ?? []) out.push(ev);
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

  /**
   * Fetch every payment for ONE subscription (GET /pg/subscriptions/{id}/payments).
   * Unlike recon, this returns ALL charges (incl. failed/declined) immediately, with
   * no settlement wait — it's how the poller self-heals recurring charges that the
   * webhook never delivered. `ctx` carries subscription display fields for the row.
   * Returns [] (never throws) on a per-subscription error so the poller keeps going.
   */
  async fetchSubscriptionPayments(
    subscriptionId: string,
    ctx: {
      planName?: string | null;
      customerName?: string | null;
      customerEmail?: string | null;
      customerPhone?: string | null;
      currency?: string | null;
    } = {}
  ): Promise<NormalizedTransaction[]> {
    try {
      const res = await fetch(
        `${CASHFREE_BASE}/subscriptions/${encodeURIComponent(subscriptionId)}/payments`,
        { method: "GET", headers: this.headers, next: { revalidate: 0 } }
      );
      if (!res.ok) {
        // 404 = subscription no longer visible; other codes = transient. Either way,
        // skip this one and let the next poll retry (idempotent).
        return [];
      }
      const body = (await res.json()) as
        | { data?: CashfreeSubscriptionApiPayment[] }
        | CashfreeSubscriptionApiPayment[];
      const payments = Array.isArray(body) ? body : body.data ?? [];
      const out: NormalizedTransaction[] = [];
      for (const pay of payments) {
        const txn = normalizeCashfreeSubscriptionApiPayment(pay, { subscriptionId, ...ctx });
        if (txn) out.push(txn);
      }
      return out;
    } catch {
      return [];
    }
  }
}
