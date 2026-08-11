import type { createServiceClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import type { NormalizedSubscription, NormalizedSubscriptionEvent, SubscriptionAdapterResult } from "./types";
import { getInrRates } from "@/lib/fx/rates";

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

const BASE_CURRENCY = "INR";

/**
 * INR value of `amount` in `currency`, converted at the ECB rate for `isoWhen`'s
 * date (the same per-date basis transactions use — never a flat rate). For a
 * subscription this is its START date, frozen once: the recurring price is booked
 * at the FX of the day the mandate began, matching "convert on the transaction's
 * own date". Returns null when the currency has no published rate yet (leave the
 * column unset so a later pass fills it rather than storing a wrong number).
 */
async function toInrOnDate(amount: number, currency: string, isoWhen: string): Promise<number | null> {
  if (currency === BASE_CURRENCY) return amount;
  const d = isoWhen.slice(0, 10);
  const rate = (await getInrRates(currency, [d])).get(d);
  return rate != null ? Math.round(amount * rate * 100) / 100 : null;
}

/**
 * Upsert a subscription snapshot into `subscriptions` (merge, never null-clobber).
 * Only keys the adapter actually SET (value !== undefined) are written, so a sparse
 * payload (e.g. a charge event carrying just ids) can't wipe the rich plan/customer
 * a prior STATUS event wrote. Keyed on (gateway, subscription_id). Best-effort: a
 * missing table (migration 032 not applied) is swallowed so callers never break.
 */
export async function upsertSubscription(
  supabase: ServiceClient,
  orgId: string,
  connectorId: string | null,
  sub: NormalizedSubscription
): Promise<void> {
  const nowIso = new Date().toISOString();
  const row: Record<string, unknown> = {
    org_id: orgId,
    gateway: sub.gateway,
    subscription_id: sub.subscription_id,
    updated_at: nowIso,
  };
  if (connectorId) row.connector_id = connectorId;

  // INR-normalized recurring amount for MRR, converted at the subscription's
  // START-date FX (per-date, frozen once — no flat rate). started_at is the mandate
  // creation date; fall back to the current period start, then now. Only assigned
  // when a value is produced, so a not-yet-published rate leaves the merge untouched
  // (a later re-sync/backfill fills it) instead of clobbering an existing figure.
  if (sub.plan_amount != null) {
    const cur = sub.currency ?? BASE_CURRENCY;
    const whenIso = sub.started_at ?? sub.current_period_start ?? nowIso;
    const base = await toInrOnDate(sub.plan_amount, cur, whenIso);
    if (base != null) row.amount_base = base;
  }

  for (const [k, v] of Object.entries(sub)) {
    if (k === "gateway" || k === "subscription_id" || k === "raw") continue;
    if (v !== undefined) row[k] = v;
  }
  if (sub.raw !== undefined) row.raw = sub.raw as Json;

  try {
    await supabase
      .from("subscriptions")
      .upsert(row as Database["public"]["Tables"]["subscriptions"]["Insert"], { onConflict: "gateway,subscription_id" });
  } catch (e) {
    console.error("[subscriptions] upsert failed (non-fatal):", e);
  }
}

/**
 * Append lifecycle/charge events, idempotently. Rows with an `event_ref` dedup on the
 * unique (gateway, event_ref) index (insert + swallow 23505). Best-effort.
 */
export async function insertSubscriptionEvents(
  supabase: ServiceClient,
  orgId: string,
  events: NormalizedSubscriptionEvent[]
): Promise<void> {
  for (const ev of events) {
    // Convert the event amount at the event's OWN date (per-date FX, never flat).
    const evBase = ev.amount != null ? await toInrOnDate(ev.amount, ev.currency ?? BASE_CURRENCY, ev.event_at) : null;
    const row: Database["public"]["Tables"]["subscription_events"]["Insert"] = {
      org_id: orgId,
      gateway: ev.gateway,
      subscription_id: ev.subscription_id,
      event_type: ev.event_type,
      event_at: ev.event_at,
      native_event_type: ev.native_event_type ?? null,
      amount: ev.amount ?? null,
      currency: ev.currency ?? null,
      amount_base: evBase,
      transaction_external_id: ev.transaction_external_id ?? null,
      event_ref: ev.event_ref ?? null,
      raw: (ev.raw ?? null) as Json,
    };
    try {
      const { error } = await supabase.from("subscription_events").insert(row);
      if (error && error.code !== "23505") {
        console.error(`[subscription_events] insert failed (${ev.event_type}):`, error.message);
      }
    } catch (e) {
      console.error("[subscription_events] insert threw (non-fatal):", e);
    }
  }
}

/** Persist a whole adapter result (snapshot + events) for one org/connector. */
export async function persistSubscriptionResult(
  supabase: ServiceClient,
  orgId: string,
  connectorId: string | null,
  result: SubscriptionAdapterResult
): Promise<void> {
  if (result.subscription) await upsertSubscription(supabase, orgId, connectorId, result.subscription);
  if (result.events.length) await insertSubscriptionEvents(supabase, orgId, result.events);
}
