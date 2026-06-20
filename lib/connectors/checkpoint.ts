import type { createServiceClient } from "@/lib/supabase/server";

type SupabaseLike = Awaited<ReturnType<typeof createServiceClient>>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Incremental-sync tuning.
 *
 * OVERLAP_DAYS      — re-sync a short trailing window each run so late-arriving
 *                     rows and status mutations (captured → refunded) are caught.
 *                     Dedup on external_id makes the re-read free.
 * MAX_STEP_DAYS     — the widest window a single incremental call/cron step will
 *                     process. Keeps every function well under the time budget;
 *                     a connector that's fallen behind catches up over several
 *                     bounded steps instead of one unbounded (timeout-prone) call.
 * INITIAL_BACKFILL_DAYS — fallback floor when a connector has no checkpoint yet
 *                     (should be rare — new connectors are stamped at creation).
 *                     Deep history is loaded via explicit, parallel-chunked backfill.
 */
export const OVERLAP_DAYS = 3;
export const MAX_STEP_DAYS = 14;
export const INITIAL_BACKFILL_DAYS = 30;

export type IncrementalStep = {
  fromDate: Date;
  toDate: Date;
  /** true when there is still older→newer ground to cover before reaching `now`. */
  hasMore: boolean;
};

/**
 * Compute the next bounded window to sync from a connector's checkpoint.
 * Always contiguous and forward-only, so repeated steps never leave a gap.
 */
export function computeIncrementalStep(
  syncedThrough: string | null,
  now: Date = new Date()
): IncrementalStep {
  const floorMs = syncedThrough
    ? new Date(syncedThrough).getTime() - OVERLAP_DAYS * DAY_MS
    : now.getTime() - INITIAL_BACKFILL_DAYS * DAY_MS;

  const from = new Date(Math.min(floorMs, now.getTime()));
  const to = new Date(Math.min(from.getTime() + MAX_STEP_DAYS * DAY_MS, now.getTime()));

  return { fromDate: from, toDate: to, hasMore: to.getTime() < now.getTime() };
}

/**
 * Advance a connector's checkpoint to `through`, never regressing it. Safe to
 * call from concurrent syncs — the guard keeps the highest value wins.
 */
export async function advanceCheckpoint(
  supabase: SupabaseLike,
  connectorId: string,
  through: Date
): Promise<void> {
  const iso = through.toISOString();
  await supabase
    .from("connectors")
    .update({ synced_through: iso })
    .eq("id", connectorId)
    .or(`synced_through.is.null,synced_through.lt.${iso}`);
}
