import type {
  NormalizedSubscription, NormalizedSubscriptionEvent, SubscriptionAdapterResult, SubscriptionStatus,
} from "../types";

// Razorpay subscription object (+ separately-fetched plan and customer, since the
// subscription only references plan_id/customer_id).
type RazorpaySubscription = {
  id: string;
  status?: string;                 // created|authenticated|active|pending|halted|cancelled|completed|expired|paused
  plan_id?: string;
  customer_id?: string;
  total_count?: number;
  paid_count?: number;
  remaining_count?: number;
  current_start?: number | null;   // unix seconds
  current_end?: number | null;
  charge_at?: number | null;
  start_at?: number | null;
  end_at?: number | null;
  ended_at?: number | null;
};
type RazorpayPlan = {
  period?: string;                 // daily|weekly|monthly|yearly
  interval?: number;
  item?: { name?: string | null; amount?: number | null; currency?: string | null };
};
type RazorpayCustomer = { name?: string | null; email?: string | null; contact?: string | null };

const gateway = "razorpay" as const;
const iso = (sec?: number | null): string | null => (sec != null ? new Date(sec * 1000).toISOString() : null);

function mapStatus(s: string | null | undefined): SubscriptionStatus {
  switch ((s ?? "").toLowerCase()) {
    case "active":
    case "authenticated": return "active";
    case "paused": return "paused";
    case "pending":
    case "halted": return "past_due";
    case "cancelled": return "cancelled";
    case "completed": return "completed";
    case "expired": return "expired";
    case "created": return "unknown"; // created but not yet authenticated
    default: return "unknown";
  }
}

function mapInterval(period: string | null | undefined): NormalizedSubscription["billing_interval"] {
  switch ((period ?? "").toLowerCase()) {
    case "daily": return "day";
    case "weekly": return "week";
    case "monthly": return "month";
    case "yearly": return "year";
    default: return null;
  }
}

export function razorpaySubscriptionAdapter(
  sub: RazorpaySubscription,
  ctx: { plan?: RazorpayPlan | null; customer?: RazorpayCustomer | null } = {}
): SubscriptionAdapterResult {
  if (!sub?.id) return { subscription: null, events: [] };
  const plan = ctx.plan ?? {};
  const cust = ctx.customer ?? {};
  const status = mapStatus(sub.status);

  const subscription: NormalizedSubscription = {
    gateway, subscription_id: sub.id,
    customer_gateway_id: sub.customer_id ?? undefined,
    customer_name: cust.name ?? undefined,
    customer_email: cust.email ?? undefined,
    customer_phone: cust.contact ?? undefined,
    plan_id: sub.plan_id ?? undefined,
    plan_name: plan.item?.name ?? undefined,
    plan_amount: plan.item?.amount != null ? plan.item.amount / 100 : undefined,
    currency: plan.item?.currency ? plan.item.currency.toUpperCase() : undefined,
    billing_interval: mapInterval(plan.period),
    interval_count: plan.interval ?? undefined,
    status, native_status: sub.status ?? undefined,
    started_at: iso(sub.start_at) ?? undefined,
    current_period_start: iso(sub.current_start) ?? undefined,
    current_period_end: iso(sub.current_end) ?? undefined,
    next_charge_at: iso(sub.charge_at) ?? undefined,
    ended_at: iso(sub.ended_at) ?? iso(sub.end_at) ?? undefined,
    total_cycles: sub.total_count ?? undefined,
    paid_count: sub.paid_count ?? undefined,
    remaining_count: sub.remaining_count ?? undefined,
    last_synced_at: new Date().toISOString(),
    raw: { subscription: sub, plan: ctx.plan ?? null, customer: ctx.customer ?? null },
  };

  const events: NormalizedSubscriptionEvent[] = [];
  if (sub.start_at != null) events.push({ gateway, subscription_id: sub.id, event_type: "created", native_event_type: "subscription.created", event_at: iso(sub.start_at)!, event_ref: `rzp_sub_created_${sub.id}`, raw: sub });
  if (status === "cancelled" && sub.ended_at != null) events.push({ gateway, subscription_id: sub.id, event_type: "cancelled", native_event_type: "subscription.cancelled", event_at: iso(sub.ended_at)!, event_ref: `rzp_sub_cancelled_${sub.id}`, raw: sub });

  return { subscription, events };
}
