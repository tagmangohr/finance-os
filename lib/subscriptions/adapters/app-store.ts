import type {
  NormalizedSubscription,
  NormalizedSubscriptionEvent,
  SubscriptionAdapterResult,
  SubscriptionStatus,
  SubscriptionEventType,
} from "../types";

// Fiesta relays Apple's already-decoded notification as
// { notificationUUID, notificationType, subtype, transaction }.
// `transaction` is the decoded JWSTransactionDecodedPayload. Fiesta does NOT relay
// `renewalInfo`, so we DERIVE subscription state from the notification stream.
type AppStoreRelay = {
  notificationUUID?: string;
  notificationType?: string;
  subtype?: string;
  transaction?: {
    originalTransactionId?: string;
    transactionId?: string;
    productId?: string;
    price?: number;               // milliunits
    currency?: string;
    type?: string;                // "Auto-Renewable Subscription" | …
    purchaseDate?: number;        // ms
    originalPurchaseDate?: number;// ms
    expiresDate?: number;         // ms
    environment?: string;
    subscriptionGroupIdentifier?: string;
  };
};

const gateway = "app_store" as const;
const msToIso = (ms?: number): string | null => (ms != null ? new Date(ms).toISOString() : null);

/** notificationType (+subtype) → derived status / event / flags. */
function derive(nt: string, sub: string): {
  status?: SubscriptionStatus; event?: SubscriptionEventType; moneyIn?: boolean;
  cancelAtPeriodEnd?: boolean; autoRenew?: boolean;
} {
  switch (nt) {
    case "SUBSCRIBED":
      return { status: "active", event: sub === "RESUBSCRIBE" ? "reactivated" : "activated", autoRenew: true };
    case "DID_RENEW":
      return { status: "active", event: "renewed", moneyIn: true, autoRenew: true };
    case "OFFER_REDEEMED":
      return { status: "active", event: "activated" };
    case "DID_CHANGE_RENEWAL_STATUS":
      return sub === "AUTO_RENEW_DISABLED"
        ? { event: "cancelled", cancelAtPeriodEnd: true, autoRenew: false }
        : { event: "resumed", cancelAtPeriodEnd: false, autoRenew: true };
    case "DID_CHANGE_RENEWAL_PREF":
    case "PRICE_INCREASE":
      return { event: "plan_changed" };
    case "DID_FAIL_TO_RENEW":
      return { status: "past_due", event: "charge_failed" };
    case "GRACE_PERIOD_EXPIRED":
    case "EXPIRED":
      return { status: "expired", event: "expired" };
    case "REFUND":
      return { event: "refunded", moneyIn: false };
    case "REVOKE":
      return { status: "expired", event: "refunded" };
    default:
      return {};
  }
}

/**
 * Normalize one Fiesta-relayed App Store notification into a subscription snapshot +
 * events. Only auto-renewable subscriptions are handled; one-time products return
 * nothing (they aren't subscriptions). subscription_id = originalTransactionId;
 * current_period_end = expiresDate; charges link to the appstore_<transactionId> row.
 */
export function appStoreSubscriptionAdapter(body: AppStoreRelay): SubscriptionAdapterResult {
  const t = body.transaction;
  const nt = (body.notificationType ?? "").toUpperCase();
  const sub = (body.subtype ?? "").toUpperCase();
  if (!t || !t.originalTransactionId) return { subscription: null, events: [] };
  // Only auto-renewable subscriptions belong here.
  if (t.type && !/subscription/i.test(t.type)) return { subscription: null, events: [] };

  const subId = String(t.originalTransactionId);
  const d = derive(nt, sub);
  const whenIso = msToIso(t.purchaseDate) ?? new Date().toISOString();

  const subscription: NormalizedSubscription = {
    gateway,
    subscription_id: subId,
    plan_id: t.productId ?? undefined,
    plan_name: t.productId ?? undefined,
    plan_amount: t.price != null ? t.price / 1000 : undefined,
    currency: t.currency ?? undefined,
    billing_interval: null,                    // Apple doesn't include interval in the transaction
    status: d.status ?? undefined,
    native_status: sub ? `${nt}.${sub}` : nt,
    auto_renew: d.autoRenew ?? undefined,
    cancel_at_period_end: d.cancelAtPeriodEnd ?? undefined,
    started_at: msToIso(t.originalPurchaseDate) ?? undefined,
    current_period_end: msToIso(t.expiresDate) ?? undefined,
    ended_at: d.status === "expired" ? (msToIso(t.expiresDate) ?? whenIso) : undefined,
    last_event_type: subscription_native(nt, sub),
    last_event_at: whenIso,
    raw: body,
  };

  const events: NormalizedSubscriptionEvent[] = [];
  if (d.event) {
    events.push({
      gateway, subscription_id: subId, event_type: d.event,
      native_event_type: subscription_native(nt, sub), event_at: whenIso,
      amount: d.moneyIn && t.price != null ? t.price / 1000 : undefined,
      currency: t.currency ?? undefined,
      transaction_external_id: d.moneyIn && t.transactionId ? `appstore_${t.transactionId}` : undefined,
      // notificationUUID is unique per notification → clean idempotency key.
      event_ref: body.notificationUUID ? `as_${body.notificationUUID}` : (t.transactionId ? `as_txn_${t.transactionId}` : undefined),
      raw: body,
    });
  }

  return { subscription, events };
}

function subscription_native(nt: string, sub: string): string {
  return sub ? `${nt}.${sub}` : nt;
}
