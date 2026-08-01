import Stripe from "stripe";
import {
  NormalizedTransaction,
  StripeCharge,
  StripePayout,
  StripeDispute,
  normalizeStripeCharge,
  normalizeStripePayout,
  normalizeStripeDispute,
  isTagMangoCharge,
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

  // ─── Fees (balance transactions) ────────────────────────────────────────────
  // The processing fee lives on the charge's balance transaction, NOT the charge
  // event — so it never arrives via webhook or the events delta. Sweep the
  // balance-transactions feed (type=charge) to reconcile it. Fee is returned in the
  // SAME units as normalizeStripeCharge (bt.fee/100, zero-decimal-aware), so the
  // summary's INR conversion stays identical. Bounded by deadlineMs.
  async fetchChargeFeesSince(
    opts: { sinceSec: number; deadlineMs: number }
  ): Promise<{ chargeId: string; fee: number }[]> {
    const ZERO_DECIMAL = new Set([
      "BIF","CLP","DJF","GNF","JPY","KMF","KRW","MGA","PYG","RWF","UGX","VND","VUV","XAF","XOF","XPF",
    ]);
    const out: { chargeId: string; fee: number }[] = [];
    let startingAfter: string | undefined;
    while (Date.now() < opts.deadlineMs) {
      // No `type` filter: a charge's balance transaction is type "charge" for
      // classic charges but "payment" for PaymentIntent-based ones — filtering to
      // "charge" silently drops the latter. We instead key on the source id prefix
      // (ch_/py_), which captures both and naturally excludes refunds/payouts.
      const page = await this.stripe.balanceTransactions.list({
        created: { gte: opts.sinceSec },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const bt of page.data) {
        const src =
          typeof bt.source === "string" ? bt.source
          : bt.source && "id" in bt.source ? bt.source.id
          : null;
        if (!src || (!src.startsWith("ch_") && !src.startsWith("py_"))) continue;
        if (typeof bt.fee !== "number") continue;
        const fee = ZERO_DECIMAL.has((bt.currency || "").toUpperCase()) ? bt.fee : bt.fee / 100;
        out.push({ chargeId: src, fee });
      }
      if (!page.has_more || page.data.length === 0) break;
      startingAfter = page.data[page.data.length - 1].id;
    }
    return out;
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
        if (isTagMangoCharge(charge as unknown as StripeCharge)) continue; // exclude shared-account TagMango
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
    opts: { gteSec: number; lteSec: number; startingAfter: string | null; deadlineMs: number; maxRows?: number }
  ): Promise<{ transactions: NormalizedTransaction[]; nextCursor: string | null; hasMore: boolean }> {
    const results: NormalizedTransaction[] = [];
    const created = { gte: opts.gteSec, lte: opts.lteSec };
    let startingAfter = opts.startingAfter ?? undefined;
    let hasMore = true;
    // Cap rows per chunk so the downstream persist (insert + bounded UPDATEs) always
    // fits the worker's function budget — without this, a fast stream could fetch
    // many thousands of rows in one chunk and the persist would blow the 60s wall.
    // Stopping early keeps hasMore=true and a forward cursor, so the next pass
    // resumes seamlessly from here.
    const maxRows = opts.maxRows ?? 2000;

    while (Date.now() < opts.deadlineMs && results.length < maxRows) {
      const params = { created, limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) };
      const page =
        stream === "charges"
          ? await this.stripe.charges.list({
              ...params,
              // Needed for the processing fee (balance_transaction.fee). Safe under
              // the resumable engine: heavier pages just mean fewer per time-boxed
              // chunk, never a timeout.
              expand: ["data.balance_transaction"],
            } as Stripe.ChargeListParams)
          : stream === "payouts"
          ? await this.stripe.payouts.list(params as Stripe.PayoutListParams)
          : await this.stripe.disputes.list(params as Stripe.DisputeListParams);

      for (const item of page.data) {
        if (stream === "charges" && isTagMangoCharge(item as unknown as StripeCharge)) continue; // exclude TagMango
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

  // ─── Events delta ───────────────────────────────────────────────────────────
  // Pull everything that CHANGED since a checkpoint via /v1/events (new charges,
  // status changes, refunds, disputes, payouts) — instead of re-scanning the whole
  // window. Tiny + flat-cost regardless of how much historical data exists. Events
  // are processed oldest→newest and bounded by a deadline, returning the created
  // time of the last fully-processed event so the caller can resume exactly there.

  async fetchEventsSince(
    opts: { sinceSec: number; deadlineMs: number }
  ): Promise<{ transactions: NormalizedTransaction[]; processedThrough: number | null; complete: boolean }> {
    // charge.* events embed the full charge object (status, refunded, amount), so a
    // refund/status change is captured WITHOUT a per-charge API call — critical on a
    // high-volume account (hundreds of changed charges/day). The only field not in
    // the event is the processing `fee` (it lives on the balance transaction); that's
    // reconciled by the periodic/on-demand full backfill, which expands it.
    const DISPUTE = new Set([
      "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed",
      "charge.dispute.funds_withdrawn", "charge.dispute.funds_reinstated",
    ]);
    const PAYOUT = new Set([
      "payout.created", "payout.updated", "payout.paid", "payout.failed", "payout.canceled",
    ]);
    // Includes charge.refunded → the charge object carries refunded=true +
    // amount_refunded, so refunds land as a status/metadata change on the charge.
    const CHARGE = new Set([
      "charge.succeeded", "charge.failed", "charge.captured", "charge.updated",
      "charge.refunded", "charge.pending", "charge.expired",
    ]);
    // Filter at the API (types[]) so we only page through events we act on. Without
    // this we'd page the account's ENTIRE event stream (failed payment_intents,
    // invoices, checkout sessions…) — thousands/day — and blow the listing budget.
    const TYPES = [...CHARGE, ...DISPUTE, ...PAYOUT]; // 17 types (Stripe caps types[] at 20)

    // 1. Read the FULL relevant-event list since the checkpoint. If we can't finish
    //    listing within the deadline we report complete=false — the caller then punts
    //    to a full backfill rather than advancing the checkpoint past unread (older)
    //    events, which would leave a gap (events list newest-first).
    const events: Stripe.Event[] = [];
    let startingAfter: string | undefined;
    let complete = false;
    while (true) {
      if (Date.now() >= opts.deadlineMs) { complete = false; break; }
      const page = await this.stripe.events.list({
        created: { gte: opts.sinceSec },
        limit: 100,
        types: TYPES,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      events.push(...page.data);
      if (!page.has_more || page.data.length === 0) { complete = true; break; }
      startingAfter = page.data[page.data.length - 1].id;
    }
    if (!complete) return { transactions: [], processedThrough: null, complete: false };

    // 2. Oldest→newest, deduped by external_id (newest state wins) so a charge with
    //    several events this window produces one upsert with its latest state.
    events.reverse();
    const byId = new Map<string, NormalizedTransaction>();
    let processedThrough: number | null = null;
    for (const ev of events) {
      const obj = ev.data.object as unknown as Record<string, unknown>;
      try {
        let txn: NormalizedTransaction | null = null;
        if (DISPUTE.has(ev.type)) txn = normalizeStripeDispute(obj as unknown as StripeDispute);
        else if (PAYOUT.has(ev.type)) txn = normalizeStripePayout(obj as unknown as StripePayout);
        else if (CHARGE.has(ev.type)) {
          const c = obj as unknown as StripeCharge;
          if (!isTagMangoCharge(c)) txn = normalizeStripeCharge(c); // skip TagMango charge events
        }
        if (txn?.external_id) byId.set(txn.external_id, txn);
      } catch {
        // A single malformed object must not abort the whole delta.
      }
      processedThrough = ev.created;
    }

    return { transactions: [...byId.values()], processedThrough, complete: true };
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
