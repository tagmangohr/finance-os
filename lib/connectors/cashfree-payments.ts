import { decryptConfigSecrets } from "@/lib/crypto/secrets";
import { CashfreeConnector } from "@/lib/connectors/cashfree";
import { normalizeCashfreeReconEvent, type CashfreeReconEvent } from "@/lib/normalizer";
import { persistTransactions } from "@/lib/connectors/sync";
import { getExistingTransactionsByExternalId } from "@/lib/db/dedup";
import type { createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type SupabaseLike = Awaited<ReturnType<typeof createServiceClient>>;
type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];
type Json = Database["public"]["Tables"]["transactions"]["Row"]["metadata"];

/**
 * Reconcile Cashfree PAYMENTS from the settlement-recon feed — the MONEY-TRUTH.
 *
 * WHY this exists: Cashfree ingestion is webhook-primary, and two gaps leave real,
 * SETTLED revenue out of our books:
 *   1. DELIVERY GAPS — Cashfree never delivers a PAYMENT/SUBSCRIPTION_PAYMENT_SUCCESS
 *      webhook for a payment, so the row never lands (≈319 payments / ₹14.4L in Sep
 *      2026 alone). Nothing backfills it.
 *   2. MIS-CLASSIFICATION — a subscription's first charge rides the mandate AUTH;
 *      when enrollment fails ("Invalid Token Bin" / "Authorization amount does not
 *      match") Cashfree stamps payment_status=FAILED on the webhook EVEN THOUGH the
 *      card was charged and the money settled. We trusted the webhook → stuck `failed`.
 *
 * The settlement-recon feed is the only source that proves money actually moved (it
 * carries event_settlement_amount + a bank reference). So we treat a recon
 * PAYMENT·SUCCESS·CREDIT as authoritative:
 *   • ABSENT in our books  → insert it as `completed` (full event_amount; identity,
 *     fee, utr from recon). subscription_id is left null and the subscription poller
 *     tags it fill-only on its next pass (ids align: cf_pay_<cf_payment_id>).
 *   • present but FAILED/PENDING → flip to `completed`, PRESERVING the webhook's
 *     identity + failure context (merge, never clobber) and stamping markers so ops
 *     can still see it was an enrollment failure. Never touches a completed/refunded
 *     row (atomic finality guard), never moves the row's date/subscription_id.
 *
 * Idempotent (keyed on cf_pay_<cf_payment_id>, which the webhook uses too) and
 * self-healing — a re-run costs nothing. All INR (Cashfree settles in INR).
 */
export async function reconcileCashfreePayments(
  supabase: SupabaseLike,
  connector: ConnectorRow,
  opts: { fromDate: Date; toDate: Date; deadlineMs: number; rawEvents?: CashfreeReconEvent[] }
): Promise<{ inserted: number; healed: number; seen: number }> {
  const cfg = decryptConfigSecrets((connector.config ?? {}) as Record<string, string>);
  if (!cfg.client_id || !cfg.client_secret) return { inserted: 0, healed: 0, seen: 0 };

  const recon = opts.rawEvents
    ? opts.rawEvents.map(normalizeCashfreeReconEvent).filter((t): t is NonNullable<typeof t> => t != null)
    : await new CashfreeConnector(cfg.client_id, cfg.client_secret).fetchReconEvents(opts.fromDate, opts.toDate);

  // Money-truth only: a successful payment CREDIT that actually settled.
  const payments = recon.filter(
    (t) => t.category === "payment" && t.type === "credit" && t.status === "completed" && !!t.external_id
  );
  if (payments.length === 0) return { inserted: 0, healed: 0, seen: 0 };

  // One settlement per payment id — dedup, last-wins.
  const byId = new Map<string, (typeof payments)[number]>();
  for (const t of payments) byId.set(t.external_id as string, t);
  const ids = [...byId.keys()];

  let inserted = 0, healed = 0;
  for (let i = 0; i < ids.length; i += 200) {
    if (Date.now() > opts.deadlineMs) break; // respect the caller's budget
    const batch = ids.slice(i, i + 200);
    const existing = await getExistingTransactionsByExternalId(supabase, connector.org_id, batch);

    const toInsert: (typeof payments)[number][] = [];
    for (const id of batch) {
      const t = byId.get(id)!;
      const matches = existing.get(id) ?? [];
      if (matches.length === 0) {
        // Never ingested — mark it as recon-sourced so it's auditable.
        const meta = { ...t.metadata, healed_from_recon: true, settled: true };
        toInsert.push({ ...t, metadata: meta });
        continue;
      }
      for (const ex of matches) {
        // Already terminal and correct — leave it (fee-fill is reconcileCashfreeFees' job).
        if (ex.status === "completed" || ex.status === "refunded") continue;
        // Flip failed/pending → completed. MERGE metadata: keep the webhook's identity
        // (email/phone/subscription ids) + failure context; add heal markers. Settlement
        // recon proving success means the enrollment-failure rows were charged anyway.
        const exMeta = (ex.metadata ?? {}) as Record<string, unknown>;
        const reconMeta = (t.metadata ?? {}) as Record<string, unknown>;
        const wasEnrollmentFailure =
          ex.status === "failed" &&
          (exMeta.failure_reason != null || /AUTH|FAILED/i.test(String(exMeta.event_type ?? "")));
        const mergedMeta: Record<string, unknown> = {
          ...exMeta,
          healed_from_recon: true,
          settled: true,
          ...(wasEnrollmentFailure ? { enrollment_failed: true } : {}),
          // fill fee/utr from recon when the webhook row lacked them
          ...(exMeta.fee == null && reconMeta.fee != null ? { fee: reconMeta.fee } : {}),
          ...(exMeta.utr == null && reconMeta.utr != null ? { utr: reconMeta.utr } : {}),
        };
        const { count, error } = await supabase
          .from("transactions")
          .update({
            status: "completed",
            metadata: mergedMeta as Json,
            // fill customer identity only if the existing row lacks it
            counterparty_name: ex.counterparty_name ?? t.counterparty_name ?? null,
          }, { count: "exact" })
          .eq("id", ex.id)
          .eq("org_id", connector.org_id)
          // Atomic finality guard: a `completed` write must never clobber a refunded row.
          .or("status.is.null,status.not.in.(refunded)");
        if (!error && (count ?? 0) > 0) healed++;
      }
    }

    if (toInsert.length > 0) {
      // Route through the single persist chokepoint (fx, identity backstop, pending
      // guard, atomic finality). recon rows are completed INR credits, so none are
      // dropped. subscription_id is null here; the poller tags it fill-only later.
      const res = await persistTransactions(supabase, connector.org_id, connector.id, toInsert);
      inserted += res.inserted;
    }
  }

  return { inserted, healed, seen: ids.length };
}
