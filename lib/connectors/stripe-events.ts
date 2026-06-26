import type { createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { StripeConnector } from "@/lib/connectors/stripe";
import { persistTransactions, SyncConfigError } from "@/lib/connectors/sync";
import { decryptConfigSecrets } from "@/lib/crypto/secrets";

type SupabaseLike = Awaited<ReturnType<typeof createServiceClient>>;
type ConnectorRow = Database["public"]["Tables"]["connectors"]["Row"];

/** Re-check a small trailing overlap each run so a boundary change can't slip
 *  through; idempotent upserts (dedup on external_id) make the overlap free. */
const OVERLAP_SEC = 2 * 60;
/** Stripe retains events ~30 days. If our checkpoint is older than this, the events
 *  feed can't be trusted to be complete — fall back to a full backfill instead. */
const MAX_STALE_DAYS = 25;

/**
 * Incremental "what changed since last run" sync for a Stripe connector via the
 * events feed — the cheap, flat-cost replacement for re-scanning the whole FY.
 * Captures new charges, status changes, refunds, disputes and payouts.
 *
 * Returns `needsBackfill: true` (WITHOUT touching anything) when it can't safely run
 * a delta — no checkpoint yet (never seeded) or the checkpoint is too stale for the
 * 30-day events window — so the caller runs a full backfill instead. Otherwise it
 * persists the delta and advances `events_synced_through` to the last event it fully
 * processed (resumable: a deadline cut-off just resumes there next run).
 */
export async function syncStripeEventsDelta(
  supabase: SupabaseLike,
  connector: ConnectorRow,
  deadlineMs: number
): Promise<{ processed: number; advancedTo: string | null; needsBackfill: boolean }> {
  const checkpoint = connector.events_synced_through;
  if (!checkpoint) return { processed: 0, advancedTo: null, needsBackfill: true };

  const sinceMs = new Date(checkpoint).getTime();
  if (!Number.isFinite(sinceMs) || Date.now() - sinceMs > MAX_STALE_DAYS * 86_400_000) {
    return { processed: 0, advancedTo: null, needsBackfill: true };
  }

  const cfg = decryptConfigSecrets((connector.config ?? {}) as Record<string, string>);
  if (!cfg.secret_key) throw new SyncConfigError("Connector is missing secret_key in config");

  const client = new StripeConnector(cfg.secret_key);
  const sinceSec = Math.floor((sinceMs - OVERLAP_SEC * 1000) / 1000);
  const { transactions, processedThrough, complete } = await client.fetchEventsSince({ sinceSec, deadlineMs });

  // Couldn't read the whole event list in time (a very large catch-up): punt to a
  // full backfill rather than advancing the checkpoint past unread older events.
  if (!complete) return { processed: 0, advancedTo: null, needsBackfill: true };

  if (transactions.length > 0) {
    await persistTransactions(supabase, connector.org_id, connector.id, transactions);
  }

  // Advance to the last event's time (or now() when the window was empty) so the
  // checkpoint always moves forward and the next delta stays small.
  const advanceMs = processedThrough != null ? processedThrough * 1000 : Date.now();
  const advancedTo = new Date(Math.min(advanceMs, Date.now())).toISOString();

  await supabase
    .from("connectors")
    .update({ events_synced_through: advancedTo, last_synced_at: new Date().toISOString() })
    .eq("id", connector.id);

  return { processed: transactions.length, advancedTo, needsBackfill: false };
}
