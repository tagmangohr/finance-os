import { decryptConfigSecrets } from "@/lib/crypto/secrets";
import { RazorpayConnector } from "@/lib/connectors/razorpay";
import { normalizeRazorpayPayment } from "@/lib/normalizer";
import { persistTransactions } from "@/lib/connectors/sync";
import type { createServiceClient } from "@/lib/supabase/server";

type SupabaseLike = Awaited<ReturnType<typeof createServiceClient>>;

/**
 * Ensure the PAYMENT behind a Razorpay refund is booked into GROSS.
 *
 * A UPI "collect" that is received and then auto-refunded (enrollment/capture never
 * completed) reports captured=false and NEVER lands via the normal payments sync — but
 * the refund DOES arrive as its own `razorpay_refund` row. That leaves an ORPHAN refund:
 * net revenue is reduced by the refund with no matching gross payment (net understated).
 * The refund is proof the money moved, so we fetch the payment and book it `completed`.
 *
 * Idempotent and safe:
 *  • already `completed`/`refunded` (in gross) → no-op.
 *  • absent → inserted as `completed` (net = gross − refund = 0).
 *  • stuck `failed`/`pending` → lifted to `completed`.
 *  • we force `completed` (not the refunded-flip) so there is no refund double-count, and
 *    the status-finality guard (completed < refunded) means this can NEVER downgrade an
 *    existing `refunded` row — it only adds the missing gross side.
 */
export async function ensureRazorpayPaymentInGross(
  supabase: SupabaseLike,
  connectorId: string,
  orgId: string,
  paymentId: string | null | undefined
): Promise<"exists" | "booked" | "notfound" | "noconfig"> {
  if (!paymentId) return "notfound";

  // Fast-path: already in gross? (A transient read error here is intentionally NOT fatal —
  // persistTransactions below is the real backstop: it is idempotent on (org_id,
  // external_id) and the status-finality guard never downgrades a higher-finality row, so
  // the worst case on a failed read is one wasted Razorpay GET + a no-op persist.)
  const { data: existing } = await supabase
    .from("transactions")
    .select("status")
    .eq("org_id", orgId)
    .eq("external_id", paymentId)
    .maybeSingle();
  if (existing && (existing.status === "completed" || existing.status === "refunded")) return "exists";

  const { data: conn } = await supabase.from("connectors").select("config").eq("id", connectorId).maybeSingle();
  const cfg = decryptConfigSecrets((conn?.config ?? {}) as Record<string, string>);
  if (!cfg.key_id || !cfg.key_secret) return "noconfig";

  const pay = await new RazorpayConnector(cfg.key_id, cfg.key_secret).getPayment(paymentId);
  if (!pay) return "notfound";

  const txn = normalizeRazorpayPayment(pay);
  txn.status = "completed"; // money moved (a refund exists) → belongs in gross; finality guard protects any refunded row
  await persistTransactions(supabase, orgId, connectorId, [txn]);
  return "booked";
}
