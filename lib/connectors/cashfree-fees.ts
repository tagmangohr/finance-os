import { decryptConfigSecrets } from "@/lib/crypto/secrets";
import { CashfreeConnector, extractCashfreeDisputeFees } from "@/lib/connectors/cashfree";
import { normalizeCashfreeReconEvent, type CashfreeReconEvent } from "@/lib/normalizer";
import type { createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type SupabaseLike = Awaited<ReturnType<typeof createServiceClient>>;
type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];

/**
 * Reconcile Cashfree gateway fees over a window. Cashfree's payment/subscription
 * WEBHOOKS carry only the gross `payment_amount` — never the MDR fee. The fee
 * (service charge + GST) lives ONLY in the Settlement Reconciliation feed
 * (POST /pg/settlement/recon), and it lands a day or two late (after settlement).
 *
 * This sweeps the recon over [fromDate, toDate] and fills `metadata.fee` on the
 * matching payment rows that don't have it yet (dedup by cf_pay_<cf_txn_id>, the
 * same id the webhook used). Fill-only + identity-safe (spreads existing metadata,
 * only adds `fee`), and idempotent — a re-run costs nothing.
 *
 * WHY this exists as its own pass: the main Cashfree sync is forward-only from a
 * checkpoint, so when a recon window failed (Cashfree's recon is flaky and 400s with
 * "internal_processing_error") the checkpoint still advanced on the webhook payments
 * and the fees for that window were never retried. Running a TRAILING re-scan every
 * night (independent of the payment checkpoint) means late-settling fees and any
 * failed window are always picked up on a later night — the fees stopped landing in
 * Aug 2026 for exactly this reason.
 */
export async function reconcileCashfreeFees(
  supabase: SupabaseLike,
  connector: ConnectorRow,
  opts: { fromDate: Date; toDate: Date; deadlineMs: number; rawEvents?: CashfreeReconEvent[] }
): Promise<{ updated: number; feesSeen: number }> {
  const cfg = decryptConfigSecrets((connector.config ?? {}) as Record<string, string>);
  if (!cfg.client_id || !cfg.client_secret) return { updated: 0, feesSeen: 0 };

  // Either normalize a shared, already-fetched recon feed (the cron fetches the flaky
  // endpoint once for both the payment- and dispute-fee passes), or fetch it here.
  // fetchReconEvents walks ≤30-day windows and retries each on Cashfree's flaky recon
  // error (never throws). Each PAYMENT event carries the fee (charge + tax) on `.fee`.
  const recon = opts.rawEvents
    ? opts.rawEvents.map(normalizeCashfreeReconEvent).filter((t): t is NonNullable<typeof t> => t != null)
    : await new CashfreeConnector(cfg.client_id, cfg.client_secret).fetchReconEvents(opts.fromDate, opts.toDate);

  const feeById = new Map<string, number>();
  for (const t of recon) {
    // normalizeCashfreeReconEvent stores the fee (service charge + GST) on metadata.fee.
    const fee = Number((t.metadata as Record<string, unknown> | undefined)?.fee ?? 0);
    if (t.category === "payment" && t.external_id && fee > 0) {
      feeById.set(t.external_id, fee);
    }
  }
  if (feeById.size === 0) return { updated: 0, feesSeen: 0 };

  const ids = [...feeById.keys()];
  let updated = 0;
  for (let i = 0; i < ids.length; i += 200) {
    if (Date.now() > opts.deadlineMs) break; // respect the caller's time budget
    const { data: rows } = await supabase
      .from("transactions")
      .select("id, external_id, metadata")
      .eq("org_id", connector.org_id)
      .eq("source", "cashfree")
      .in("external_id", ids.slice(i, i + 200));
    for (const r of rows ?? []) {
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      if (m.fee != null) continue; // fill-only — never overwrite an existing fee
      const fee = feeById.get(r.external_id as string);
      if (fee == null) continue;
      // Merge, preserving the webhook's email/phone/subscription identity; add `fee`.
      const { error } = await supabase
        .from("transactions")
        .update({ metadata: { ...m, fee } as Database["public"]["Tables"]["transactions"]["Row"]["metadata"] })
        .eq("id", r.id as string);
      if (!error) updated++;
    }
  }
  return { updated, feesSeen: feeById.size };
}

/**
 * Reconcile Cashfree DISPUTE (chargeback) FEES over a window. The chargeback fee
 * (event_service_charge + event_service_tax) lives ONLY on the recon feed's
 * DISPUTE/CHARGEBACK events — which the normalizer drops (they'd duplicate the
 * webhook-owned dispute rows). So we read those events' fees directly and STAMP them
 * onto the existing dispute rows (source=cashfree_dispute) under metadata.dispute_fee,
 * matched by cf_payment_id (preferred) or order_id. Fill-only + identity-safe (spreads
 * existing metadata, only adds `dispute_fee`) and idempotent — a re-run costs nothing.
 * Never creates a row: a dispute with no webhook row yet is simply skipped (re-filled
 * on a later night once the webhook has landed). All INR (Cashfree settles in INR).
 *
 * EVENTUAL CONSISTENCY (by design, same as the payment-fee reconcile above): the fee
 * is out-of-band (the webhook that owns the dispute row never carries it), so a later
 * dispute-lifecycle webhook re-sync can wipe metadata.dispute_fee — this pass re-fills
 * it the next night. A stamped fee is not revised DOWN on a rare win-reversal, which is
 * correct for the common case (chargeback fees are typically non-refundable).
 */
export async function reconcileCashfreeDisputeFees(
  supabase: SupabaseLike,
  connector: ConnectorRow,
  opts: { fromDate: Date; toDate: Date; deadlineMs: number; rawEvents?: CashfreeReconEvent[] }
): Promise<{ updated: number; feesSeen: number; unmatched: number }> {
  const cfg = decryptConfigSecrets((connector.config ?? {}) as Record<string, string>);
  if (!cfg.client_id || !cfg.client_secret) return { updated: 0, feesSeen: 0, unmatched: 0 };

  // Reuse the shared recon feed when the caller already fetched it (see cron); else
  // fetch just the dispute fees.
  const events = opts.rawEvents
    ? extractCashfreeDisputeFees(opts.rawEvents)
    : await new CashfreeConnector(cfg.client_id, cfg.client_secret).fetchReconDisputeFees(opts.fromDate, opts.toDate);
  if (events.length === 0) return { updated: 0, feesSeen: 0, unmatched: 0 };

  // Net the fee per dispute (a chargeback + a rare win-reversal collapse to one order).
  const byPayment = new Map<string, number>();
  const byOrder = new Map<string, number>();
  for (const e of events) {
    if (e.cfPaymentId) byPayment.set(e.cfPaymentId, (byPayment.get(e.cfPaymentId) ?? 0) + e.fee);
    if (e.orderId) byOrder.set(e.orderId, (byOrder.get(e.orderId) ?? 0) + e.fee);
  }

  // Fetch the org's Cashfree dispute rows in the window and match by cf_payment_id / order_id.
  const from = opts.fromDate.toISOString().slice(0, 10);
  const to = opts.toDate.toISOString().slice(0, 10);
  const { data: rows } = await supabase
    .from("transactions")
    .select("id, metadata")
    .eq("org_id", connector.org_id)
    .eq("source", "cashfree_dispute")
    .eq("category", "dispute")
    .gte("transaction_date", from)
    .lte("transaction_date", to);

  let updated = 0;
  const consumed = new Set<string>(); // fee keys whose dispute row we found (matched)
  for (const r of rows ?? []) {
    if (Date.now() > opts.deadlineMs) break;
    const m = (r.metadata ?? {}) as Record<string, unknown>;
    const pid = m.cf_payment_id != null ? String(m.cf_payment_id) : null;
    const oid = m.order_id != null ? String(m.order_id) : null;
    const fee = (pid && byPayment.get(pid)) || (oid && byOrder.get(oid)) || 0;
    if (!(fee > 0)) continue;
    if (pid) consumed.add(`p:${pid}`);
    if (oid) consumed.add(`o:${oid}`);
    if (m.dispute_fee != null) continue; // already stamped — matched, don't rewrite
    const { error } = await supabase
      .from("transactions")
      .update({ metadata: { ...m, dispute_fee: Number(fee.toFixed(2)) } as Database["public"]["Tables"]["transactions"]["Row"]["metadata"] })
      .eq("id", r.id as string);
    if (!error) updated++;
  }

  // Distinct fee-disputes seen, and how many have no dispute row yet (webhook lag) —
  // keyed by cf_payment_id when present, else order_id, so order-only fees count too.
  let feesSeen = 0, unmatched = 0;
  const seenKeys = new Set<string>();
  for (const e of events) {
    const key = e.cfPaymentId ? `p:${e.cfPaymentId}` : e.orderId ? `o:${e.orderId}` : null;
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    feesSeen++;
    const matched = (e.cfPaymentId && consumed.has(`p:${e.cfPaymentId}`)) || (e.orderId && consumed.has(`o:${e.orderId}`));
    if (!matched) unmatched++;
  }
  return { updated, feesSeen, unmatched };
}
