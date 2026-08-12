import type { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

/**
 * Derive-from-archive (see migration 071 / gateway_events).
 *
 * The whole point of the event archive: when a future requirement appears (a metric,
 * a normalizer fix, a new derived table), you REPLAY the stored raw events instead of
 * re-syncing every gateway. This is the generic engine — it streams archived events for
 * a provider and hands each raw payload to a caller-supplied handler, then records the
 * outcome on the row (processed_at / process_error). Idempotent + resumable: it walks by
 * received_at and, by default, only picks up rows the handler hasn't consumed yet.
 *
 * A handler is just `(payload, event) => Promise<void>` — e.g. re-run a normalizer and
 * persistTransactions. Keeping the engine handler-agnostic means new derivations are
 * added without touching capture or the webhook routes.
 */

export type ArchivedEvent = {
  id: string;
  provider: string;
  connector_id: string | null;
  org_id: string | null;
  event_id: string | null;
  event_type: string | null;
  occurred_at: string | null;
  received_at: string;
  payload: Json;
};

export type ReprocessOptions = {
  provider: string;
  /** Called for each archived event. Throw to mark the row failed (it stays pending for a retry). */
  handler: (payload: Json, event: ArchivedEvent) => Promise<void>;
  /** Only events at/after this received_at (ISO). */
  since?: string;
  /** false → replay ALL matching events (e.g. after a normalizer fix); default true → only unconsumed. */
  onlyUnprocessed?: boolean;
  /** Restrict to certain event types (e.g. ["charge.succeeded"]). */
  eventTypes?: string[];
  /** Safety cap on how many to process in one run. */
  limit?: number;
  batchSize?: number;
};

export type ReprocessResult = { scanned: number; processed: number; failed: number };

export async function reprocessGatewayEvents(
  supabase: ServiceClient,
  opts: ReprocessOptions
): Promise<ReprocessResult> {
  const batchSize = Math.min(opts.batchSize ?? 500, 1000);
  const cap = opts.limit ?? Infinity;
  const out: ReprocessResult = { scanned: 0, processed: 0, failed: 0 };
  let cursor = opts.since ?? "1970-01-01T00:00:00Z";

  while (out.scanned < cap) {
    let q = supabase
      .from("gateway_events")
      .select("id, provider, connector_id, org_id, event_id, event_type, occurred_at, received_at, payload")
      .eq("provider", opts.provider)
      .gt("received_at", cursor)
      .order("received_at", { ascending: true })
      .limit(Math.min(batchSize, cap - out.scanned));
    if (opts.onlyUnprocessed !== false) q = q.is("processed_at", null);
    if (opts.eventTypes?.length) q = q.in("event_type", opts.eventTypes);

    const { data, error } = await q;
    if (error) throw new Error(`[reprocess:${opts.provider}] read failed: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const ev of data as ArchivedEvent[]) {
      out.scanned++;
      cursor = ev.received_at;
      try {
        await opts.handler(ev.payload, ev);
        await supabase.from("gateway_events").update({ processed_at: new Date().toISOString(), process_error: null }).eq("id", ev.id);
        out.processed++;
      } catch (e) {
        out.failed++;
        await supabase.from("gateway_events").update({ process_error: e instanceof Error ? e.message : String(e) }).eq("id", ev.id);
      }
    }
    if (data.length < batchSize) break;
  }
  return out;
}
