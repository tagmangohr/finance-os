import type {
  NormalizedSubscription, NormalizedSubscriptionEvent, SubscriptionAdapterResult, SubscriptionStatus,
} from "../types";

// Subset of a Stripe Subscription object (list with expand[]=data.customer and
// data.items.data.price.product so customer + plan are inline).
type StripeSubscription = {
  id: string;
  status?: string;                 // trialing|active|past_due|canceled|unpaid|incomplete|incomplete_expired|paused
  customer?: string | { id?: string; name?: string | null; email?: string | null; phone?: string | null };
  start_date?: number;             // unix seconds
  trial_start?: number | null;
  trial_end?: number | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
  cancel_at?: number | null;
  canceled_at?: number | null;
  cancel_at_period_end?: boolean;
  ended_at?: number | null;
  default_payment_method?: unknown;
  items?: { data?: Array<{ quantity?: number; price?: {
    unit_amount?: number | null; currency?: string; nickname?: string | null;
    recurring?: { interval?: string; interval_count?: number } | null;
    product?: string | { id?: string; name?: string | null };
  } }> };
};

const gateway = "stripe" as const;
const iso = (sec?: number | null): string | null => (sec != null ? new Date(sec * 1000).toISOString() : null);

function mapStatus(s: string | null | undefined): SubscriptionStatus {
  switch ((s ?? "").toLowerCase()) {
    case "trialing": return "trialing";
    case "active": return "active";
    case "past_due":
    case "unpaid": return "past_due";
    case "paused": return "paused";
    case "canceled": return "cancelled";
    case "incomplete":
    case "incomplete_expired": return "unknown"; // never fully started
    default: return "unknown";
  }
}

export function stripeSubscriptionAdapter(s: StripeSubscription): SubscriptionAdapterResult {
  if (!s?.id) return { subscription: null, events: [] };
  const cust = typeof s.customer === "object" && s.customer ? s.customer : {};
  const item = s.items?.data?.[0];
  const price = item?.price;
  const product = typeof price?.product === "object" && price?.product ? price.product : {};
  const qty = item?.quantity ?? 1;
  const status = mapStatus(s.status);

  const subscription: NormalizedSubscription = {
    gateway, subscription_id: s.id,
    customer_gateway_id: typeof s.customer === "string" ? s.customer : cust.id ?? undefined,
    customer_name: cust.name ?? undefined,
    customer_email: cust.email ?? undefined,
    customer_phone: cust.phone ?? undefined,
    plan_id: typeof price?.product === "string" ? price.product : product.id ?? undefined,
    plan_name: product.name ?? price?.nickname ?? undefined,
    plan_amount: price?.unit_amount != null ? (price.unit_amount / 100) * qty : undefined,
    currency: price?.currency ? price.currency.toUpperCase() : undefined,
    billing_interval: (price?.recurring?.interval as NormalizedSubscription["billing_interval"]) ?? undefined,
    interval_count: price?.recurring?.interval_count ?? undefined,
    status, native_status: s.status ?? undefined,
    auto_renew: s.cancel_at_period_end != null ? !s.cancel_at_period_end : undefined,
    cancel_at_period_end: s.cancel_at_period_end ?? undefined,
    started_at: iso(s.start_date) ?? undefined,
    trial_start: iso(s.trial_start) ?? undefined,
    trial_end: iso(s.trial_end) ?? undefined,
    current_period_start: iso(s.current_period_start) ?? undefined,
    current_period_end: iso(s.current_period_end) ?? undefined,
    next_charge_at: status === "active" || status === "trialing" ? iso(s.current_period_end) ?? undefined : undefined,
    cancel_requested_at: iso(s.canceled_at) ?? undefined,
    ended_at: iso(s.ended_at) ?? undefined,
    last_synced_at: new Date().toISOString(),
    raw: s,
  };

  // Snapshot-derivable lifecycle events (charges/renewals are linked separately from
  // invoices in a follow-on). start → created; canceled_at → cancelled.
  const events: NormalizedSubscriptionEvent[] = [];
  if (s.start_date != null) events.push({ gateway, subscription_id: s.id, event_type: "created", native_event_type: "subscription.start", event_at: iso(s.start_date)!, event_ref: `stripe_sub_created_${s.id}`, raw: s });
  if (s.canceled_at != null) events.push({ gateway, subscription_id: s.id, event_type: "cancelled", native_event_type: "subscription.canceled", event_at: iso(s.canceled_at)!, event_ref: `stripe_sub_cancelled_${s.id}`, raw: s });

  return { subscription, events };
}
