// ─── Cross-gateway subscription model ──────────────────────────────────────────
// Every gateway adapter (Cashfree, Stripe, Razorpay, App Store, PayU, Paytm,
// Easebuzz) normalizes its native subscription payload into these two shapes. The
// persist layer upserts them into the `subscriptions` and `subscription_events`
// tables (migration 032). Keeping the model gateway-agnostic is what lets the
// dashboard/report queries treat all gateways uniformly.

export type SubscriptionGateway =
  | "cashfree" | "stripe" | "razorpay" | "app_store" | "payu" | "paytm" | "easebuzz";

/** Normalized subscription status. Each adapter maps its native status onto this so
 *  "active count", churn, and dunning are computed the same way across gateways. */
export type SubscriptionStatus =
  | "trialing"    // in a free trial
  | "active"      // live, will renew
  | "past_due"    // a charge failed; in dunning/grace, not yet cancelled
  | "paused"      // temporarily halted (Razorpay pause, etc.)
  | "cancelled"   // cancellation requested/effective; will not renew
  | "expired"     // reached end / lapsed (App Store EXPIRED, mandate ended)
  | "completed"   // finished all cycles successfully
  | "unknown";    // couldn't be mapped (kept so nothing is silently dropped)

/** Normalized lifecycle/charge event. Powers the time-series reports. */
export type SubscriptionEventType =
  | "created"          // subscription object created (may be pre-auth)
  | "trial_started"
  | "activated"        // mandate authorized / first became active
  | "renewed"          // a recurring cycle renewed (App Store DID_RENEW, etc.)
  | "charge_succeeded" // a subscription charge succeeded (money in)
  | "charge_failed"    // a subscription charge failed (dunning signal)
  | "paused"
  | "resumed"
  | "cancelled"        // cancellation requested/auto-renew turned off
  | "expired"          // access ended / lapsed
  | "refunded"
  | "plan_changed"     // upgrade/downgrade
  | "reactivated";     // resubscribe after a lapse/cancel

/** A subscription's current state, gateway-agnostic. Mirrors the `subscriptions`
 *  table. All fields optional except the natural key so an adapter can emit whatever
 *  the specific event/payload carries; the persist layer merges (never null-clobbers). */
export type NormalizedSubscription = {
  gateway: SubscriptionGateway;
  subscription_id: string;                 // gateway-native canonical id

  customer_name?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  customer_gateway_id?: string | null;

  plan_id?: string | null;
  plan_name?: string | null;
  plan_amount?: number | null;             // recurring amount in `currency`
  currency?: string | null;
  billing_interval?: "day" | "week" | "month" | "year" | null;
  interval_count?: number | null;

  status?: SubscriptionStatus | null;
  native_status?: string | null;
  auto_renew?: boolean | null;
  cancel_at_period_end?: boolean | null;
  cancel_reason?: string | null;

  started_at?: string | null;              // ISO
  trial_start?: string | null;
  trial_end?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
  next_charge_at?: string | null;
  cancel_requested_at?: string | null;
  ended_at?: string | null;

  total_cycles?: number | null;
  paid_count?: number | null;
  remaining_count?: number | null;

  payment_method?: string | null;
  mandate_status?: string | null;
  card_last4?: string | null;
  card_expiry?: string | null;

  last_event_type?: string | null;
  last_event_at?: string | null;
  last_synced_at?: string | null;
  raw?: unknown;
};

/** A single lifecycle/charge event. */
export type NormalizedSubscriptionEvent = {
  gateway: SubscriptionGateway;
  subscription_id: string;
  event_type: SubscriptionEventType;
  native_event_type?: string | null;
  event_at: string;                        // ISO
  amount?: number | null;
  currency?: string | null;
  transaction_external_id?: string | null; // links to transactions.external_id (charge events)
  event_ref?: string | null;               // gateway's unique id for THIS event (dedup key)
  raw?: unknown;
};

/** What an adapter returns from a single native payload: the subscription snapshot
 *  to upsert, plus any events to append (a payload can imply both — e.g. a charge
 *  webhook updates the subscription AND logs a `charge_succeeded`). */
export type SubscriptionAdapterResult = {
  subscription: NormalizedSubscription | null;
  events: NormalizedSubscriptionEvent[];
};
