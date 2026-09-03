import { decryptConfigSecrets } from "@/lib/crypto/secrets";
import { CashfreeConnector } from "@/lib/connectors/cashfree";
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
  opts: { fromDate: Date; toDate: Date; deadlineMs: number }
): Promise<{ updated: number; feesSeen: number }> {
  const cfg = decryptConfigSecrets((connector.config ?? {}) as Record<string, string>);
  if (!cfg.client_id || !cfg.client_secret) return { updated: 0, feesSeen: 0 };

  const client = new CashfreeConnector(cfg.client_id, cfg.client_secret);
  // fetchReconEvents walks ≤30-day windows and retries each on Cashfree's flaky
  // recon error, returning whatever it could get (never throws). Each PAYMENT event
  // carries the fee (event_service_charge + event_service_tax) on `.fee`.
  const recon = await client.fetchReconEvents(opts.fromDate, opts.toDate);

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
