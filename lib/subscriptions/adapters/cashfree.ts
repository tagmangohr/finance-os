import type {
  NormalizedSubscription,
  NormalizedSubscriptionEvent,
  SubscriptionAdapterResult,
  SubscriptionStatus,
  SubscriptionEventType,
} from "../types";

// Real Cashfree SUBSCRIPTION_* payload (verified against live events 2026-07-29).
// Payment/AUTH events carry the charge fields directly on `data`; STATUS_CHANGED
// carries the rich subscription/plan/customer under nested objects.
type CashfreeSubPayload = {
  type?: string;
  event_time?: string;
  data?: {
    // charge (PAYMENT_/AUTH) fields
    cf_txn_id?: string | number;
    cf_payment_id?: string | number;
    payment_type?: string;
    payment_amount?: number;
    payment_currency?: string;
    payment_status?: string;
    payment_initiated_date?: string;
    subscription_id?: string;
    cf_subscription_id?: string | number;
    failure_details?: { failure_reason?: string | null };
    authorization_details?: {
      payment_group?: string;
      authorization_status?: string;
      authorization_time?: string;
    };
    // lifecycle (STATUS_CHANGED) fields
    subscription_details?: {
      subscription_id?: string;
      subscription_status?: string;
      next_schedule_date?: string | null;
      subscription_first_charge_time?: string | null;
      subscription_expiry_time?: string | null;
    };
    plan_details?: {
      plan_id?: string;
      plan_name?: string | null;
      plan_currency?: string | null;
      plan_recurring_amount?: number | null;
      plan_max_amount?: number | null;
      plan_interval_type?: string | null;   // DAY | WEEK | MONTH | YEAR
      plan_intervals?: number | null;
      plan_max_cycles?: number | null;
    };
    customer_details?: { customer_name?: string | null; customer_email?: string | null; customer_phone?: string | null };
  };
};

const gateway = "cashfree" as const;

function iso(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

/** Cashfree native subscription_status → normalized status. */
function mapStatus(native: string | null | undefined): SubscriptionStatus {
  switch ((native ?? "").toUpperCase()) {
    case "ACTIVE": return "active";
    case "PAUSED": return "paused";
    case "ON_HOLD": return "past_due";
    case "CANCELLED": return "cancelled";
    case "COMPLETED": return "completed";
    case "EXPIRED": return "expired";
    case "INITIALIZED":
    case "BANK_APPROVAL_PENDING": return "unknown"; // not yet active
    default: return "unknown";
  }
}

/** A status change → a lifecycle event (null if it implies nothing reportable). */
function statusEvent(native: string | null | undefined): SubscriptionEventType | null {
  switch ((native ?? "").toUpperCase()) {
    case "ACTIVE": return "activated";
    case "PAUSED":
    case "ON_HOLD": return "paused";
    case "CANCELLED": return "cancelled";
    case "COMPLETED":
    case "EXPIRED": return "expired";
    case "INITIALIZED":
    case "BANK_APPROVAL_PENDING": return "created";
    default: return null;
  }
}

function mapInterval(t: string | null | undefined): NormalizedSubscription["billing_interval"] {
  switch ((t ?? "").toUpperCase()) {
    case "DAY": return "day";
    case "WEEK": return "week";
    case "MONTH": return "month";
    case "YEAR": return "year";
    default: return null;
  }
}

/**
 * Normalize one Cashfree SUBSCRIPTION_* webhook into a subscription snapshot + any
 * events. Payment/AUTH events → a charge event (linked to the cf_pay_<cf_txn_id>
 * transaction) + light snapshot; STATUS_CHANGED → rich snapshot + a lifecycle event.
 */
export function cashfreeSubscriptionAdapter(payload: CashfreeSubPayload): SubscriptionAdapterResult {
  const type = (payload.type ?? "").toUpperCase();
  if (!type.startsWith("SUBSCRIPTION")) return { subscription: null, events: [] };
  const d = payload.data ?? {};
  const eventTime = iso(payload.event_time) ?? new Date().toISOString();
  const events: NormalizedSubscriptionEvent[] = [];

  // ── STATUS_CHANGED: rich lifecycle snapshot ──────────────────────────────────
  const sd = d.subscription_details;
  const subId = sd?.subscription_id ?? d.subscription_id;
  if (!subId) return { subscription: null, events: [] };

  let subscription: NormalizedSubscription = { gateway, subscription_id: String(subId) };

  if (sd) {
    const plan = d.plan_details ?? {};
    const cust = d.customer_details ?? {};
    const auth = d.authorization_details ?? {};
    const native = sd.subscription_status ?? null;
    const status = mapStatus(native);
    subscription = {
      gateway,
      subscription_id: String(subId),
      customer_name: cust.customer_name ?? undefined,
      customer_email: cust.customer_email ?? undefined,
      customer_phone: cust.customer_phone ?? undefined,
      plan_id: plan.plan_id ?? undefined,
      plan_name: plan.plan_name ?? undefined,
      plan_amount: plan.plan_recurring_amount ?? plan.plan_max_amount ?? undefined,
      currency: plan.plan_currency ?? undefined,
      billing_interval: mapInterval(plan.plan_interval_type),
      interval_count: plan.plan_intervals ?? undefined,
      status,
      native_status: native,
      total_cycles: plan.plan_max_cycles ?? undefined,
      started_at: iso(sd.subscription_first_charge_time) ?? iso(auth.authorization_time) ?? undefined,
      next_charge_at: iso(sd.next_schedule_date) ?? undefined,
      ended_at: status === "cancelled" || status === "expired" || status === "completed" ? eventTime : undefined,
      payment_method: auth.payment_group ?? undefined,
      mandate_status: auth.authorization_status ?? undefined,
      last_event_type: type,
      last_event_at: eventTime,
      raw: payload,
    };
    const et = statusEvent(native);
    if (et) {
      events.push({
        gateway, subscription_id: String(subId), event_type: et, native_event_type: type,
        event_at: eventTime, event_ref: `${subId}:${(native ?? "").toUpperCase()}:${eventTime}`, raw: payload,
      });
    }
  }

  // ── PAYMENT_/AUTH: a charge event (+ light snapshot enrichment) ──────────────
  if (d.payment_amount != null || d.payment_status != null) {
    const payId = d.cf_txn_id ?? d.cf_payment_id;
    const st = (d.payment_status ?? "").toUpperCase();
    const evType: SubscriptionEventType = st === "SUCCESS" ? "charge_succeeded" : st === "PENDING" ? "charge_succeeded" : "charge_failed";
    const auth = d.authorization_details ?? {};
    // Light snapshot so a subscription seen only via payment events still exists.
    subscription = {
      ...subscription,
      gateway,
      subscription_id: String(subId),
      currency: subscription.currency ?? d.payment_currency ?? undefined,
      payment_method: subscription.payment_method ?? auth.payment_group ?? undefined,
      mandate_status: subscription.mandate_status ?? auth.authorization_status ?? undefined,
      last_event_type: type,
      last_event_at: eventTime,
      raw: subscription.raw ?? payload,
    };
    if (payId != null) {
      events.push({
        gateway, subscription_id: String(subId), event_type: evType, native_event_type: type,
        event_at: iso(d.payment_initiated_date) ?? eventTime,
        amount: d.payment_amount ?? null, currency: (d.payment_currency ?? "INR"),
        transaction_external_id: `cf_pay_${payId}`,
        event_ref: `cf_subevt_${payId}`, raw: payload,
      });
    }
  }

  return { subscription, events };
}
