import { parse, isValid } from "date-fns";
import { BASE_CURRENCY } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NormalizedTransaction = {
  external_id: string | null;
  type: "credit" | "debit";
  amount: number; // full currency units (e.g. INR, not paise)
  currency: string;
  category: string | null;
  counterparty_name: string | null;
  description: string | null;
  source: string;
  status: "pending" | "completed" | "failed" | "refunded";
  transaction_date: string; // YYYY-MM-DD
  metadata: Record<string, unknown>;
  // Base-currency (INR) equivalent. Set when the connector can provide it
  // (e.g. Stripe's settled balance-transaction amount). When omitted, the sync
  // layer fills it in: amount for INR rows, null for un-converted foreign rows.
  amount_base?: number | null;
  base_currency?: string | null;
  fx_rate?: number | null;
};

export type RazorpayPayment = {
  id: string;
  entity: string;
  amount: number; // in paise
  currency: string;
  status: string; // created | authorized | captured | refunded | failed
  description: string | null;
  email: string | null;
  contact: string | null;
  notes: Record<string, unknown>;
  created_at: number; // unix timestamp
  method: string;
  order_id: string | null;
  invoice_id: string | null;
  international: boolean;
  refund_status: string | null;
  captured: boolean;
  error_code: string | null;
  error_description: string | null;
  fee: number | null;
  tax: number | null;
};

export type RazorpayPayout = {
  id: string;
  entity: string;
  fund_account_id: string;
  amount: number; // in paise
  currency: string;
  status: string; // queued | pending | processing | processed | cancelled | reversed | failed
  purpose: string;
  narration: string | null;
  mode: string;
  created_at: number;
  processed_at: number | null;
  fees: number;
  tax: number;
  notes: Record<string, unknown>;
};

export type RazorpayDispute = {
  id: string;
  entity: string;
  payment_id: string;
  amount: number; // in paise
  currency: string;
  created_at: number;
  status: string; // open | under_review | won | lost | closed | accepted
  reason_code: string | null;
  reason_description: string | null;
  phase: string | null; // chargeback | pre_arbitration | arbitration
  respondby: number | null;
  comments: string | null;
};

export type RazorpayRefund = {
  id: string;
  entity: string;
  amount: number; // in paise
  currency: string;
  payment_id: string;
  notes: Record<string, unknown>;
  receipt: string | null;
  acquirer_data: Record<string, unknown> | null;
  created_at: number;
  batch_id: string | null;
  status: string; // processed | pending | failed
  speed_processed: string | null;
  speed_requested: string | null;
};

export type RazorpaySettlement = {
  id: string;
  entity: string;
  amount: number; // in paise
  status: string; // created | processed
  fees: number; // in paise
  tax: number;  // in paise
  utr: string | null;
  created_at: number;
  onhold_amount: number;
  description: string | null;
};

export type StripeCharge = {
  id: string;
  object: "charge";
  amount: number; // in smallest currency unit (cents/paise)
  currency: string;
  status: string; // succeeded | pending | failed
  description: string | null;
  created: number; // unix timestamp
  refunded: boolean;
  amount_refunded: number;
  customer:
    | string
    | {
        id: string;
        name: string | null;
        email: string | null;
      }
    | null;
  billing_details: {
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  metadata: Record<string, string>;
  failure_code: string | null;
  failure_message: string | null;
  paid: boolean;
  // Expanded balance transaction — Stripe's settled figure in the ACCOUNT's
  // settlement currency (INR for an Indian account), with the exchange rate it
  // used. This is the authoritative INR-equivalent for a foreign-currency charge.
  balance_transaction?:
    | string
    | {
        id: string;
        amount: number;        // in settlement-currency smallest unit
        currency: string;      // settlement currency (e.g. "inr")
        exchange_rate: number | null;
        fee: number;           // Stripe processing fee, settlement-currency smallest unit
        net: number;           // amount − fee, settlement-currency smallest unit
      }
    | null;
};

export type StripePayout = {
  id: string;
  object: "payout";
  amount: number;
  currency: string;
  status: string; // paid | pending | in_transit | canceled | failed
  description: string | null;
  created: number;
  arrival_date: number;
  metadata: Record<string, string>;
};

export type StripeDispute = {
  id: string;
  object: "dispute";
  amount: number;   // disputed amount, in the charge currency's smallest unit
  currency: string;
  status: string;   // warning_needs_response | needs_response | under_review | won | lost
  reason: string | null;
  created: number;
  charge: string | null;
  metadata: Record<string, string>;
};

export type CsvColumnMapping = {
  dateCol: string;
  amountCol: string;
  typeCol?: string;
  descriptionCol?: string;
  counterpartyCol?: string;
  currencyCol?: string;
};

// ─── Date parsing helpers ─────────────────────────────────────────────────────

const DATE_FORMATS = [
  "yyyy-MM-dd",
  "dd/MM/yyyy",
  "MM/dd/yyyy",
  "dd-MM-yyyy",
  "MM-dd-yyyy",
  "dd MMM yyyy",
  "MMM dd yyyy",
  "yyyy/MM/dd",
  "d/M/yyyy",
  "d-M-yyyy",
];

export function parseDateString(raw: string): string {
  const trimmed = raw.trim();

  // Try native Date first (handles ISO strings with time)
  const native = new Date(trimmed);
  if (isValid(native) && trimmed.length > 6) {
    return native.toISOString().slice(0, 10);
  }

  // Try known formats
  for (const fmt of DATE_FORMATS) {
    const parsed = parse(trimmed, fmt, new Date());
    if (isValid(parsed)) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  // Fallback: return trimmed value (will surface as invalid date to caller)
  return trimmed;
}

function unixToDateString(ts: number): string {
  // Use IST (Asia/Kolkata, UTC+5:30) so transaction dates match what Razorpay /
  // Stripe show in their dashboards.  toISOString() always returns UTC, which
  // shifts midnight–05:30 IST transactions to the previous calendar date.
  // en-CA locale produces the YYYY-MM-DD format required by the DB date column.
  return new Date(ts * 1000).toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
}

// ─── Razorpay normalizers ─────────────────────────────────────────────────────

export function normalizeRazorpayPayment(
  payment: RazorpayPayment
): NormalizedTransaction {
  let status: NormalizedTransaction["status"];
  switch (payment.status) {
    case "captured":
      status = "completed";
      break;
    case "refunded":
      status = "refunded";
      break;
    case "failed":
      status = "failed";
      break;
    default:
      status = "pending";
  }

  const counterparty =
    payment.email ??
    payment.contact ??
    (payment.notes?.name as string | undefined) ??
    null;

  return {
    external_id: payment.id,
    type: "credit",
    amount: payment.amount / 100, // paise → rupees
    currency: (payment.currency ?? "INR").toUpperCase(),
    category: null,
    counterparty_name: counterparty,
    description: payment.description ?? null,
    source: "razorpay",
    status,
    transaction_date: unixToDateString(payment.created_at),
    metadata: {
      method: payment.method,
      order_id: payment.order_id,
      invoice_id: payment.invoice_id,
      email: payment.email,
      phone: payment.contact,
      fee: payment.fee != null ? payment.fee / 100 : null,
      tax: payment.tax != null ? payment.tax / 100 : null,
      refund_status: payment.refund_status,
      notes: payment.notes,
    },
  };
}

export function normalizeRazorpayPayout(
  payout: RazorpayPayout
): NormalizedTransaction {
  let status: NormalizedTransaction["status"];
  switch (payout.status) {
    case "processed":
      status = "completed";
      break;
    case "failed":
    case "reversed":
      status = "failed";
      break;
    case "cancelled":
      status = "failed";
      break;
    default:
      status = "pending";
  }

  return {
    external_id: payout.id,
    type: "debit",
    amount: payout.amount / 100,
    currency: (payout.currency ?? "INR").toUpperCase(),
    category: payout.purpose ?? null,
    counterparty_name: null,
    description: payout.narration ?? null,
    source: "razorpay_payout",
    status,
    transaction_date: unixToDateString(payout.created_at),
    metadata: {
      fund_account_id: payout.fund_account_id,
      mode: payout.mode,
      fees: payout.fees / 100,
      tax: payout.tax / 100,
      processed_at: payout.processed_at,
      notes: payout.notes,
    },
  };
}

export function normalizeRazorpayDispute(
  dispute: RazorpayDispute
): NormalizedTransaction {
  let status: NormalizedTransaction["status"];
  switch (dispute.status) {
    case "won":
    case "closed":
      status = "completed"; // resolved in merchant's favour
      break;
    case "lost":
    case "accepted":
      status = "failed"; // merchant lost the chargeback
      break;
    default:
      status = "pending"; // open | under_review
  }

  const reason =
    dispute.reason_description ?? dispute.reason_code ?? "Unknown reason";

  return {
    external_id: dispute.id,
    type: "debit",
    amount: dispute.amount / 100,
    currency: (dispute.currency ?? "INR").toUpperCase(),
    category: "dispute",
    counterparty_name: null,
    description: `Dispute (${dispute.phase ?? "chargeback"}): ${reason} · payment ${dispute.payment_id}`,
    source: "razorpay_dispute",
    status,
    transaction_date: unixToDateString(dispute.created_at),
    metadata: {
      payment_id: dispute.payment_id,
      phase: dispute.phase,
      reason_code: dispute.reason_code,
      reason_description: dispute.reason_description,
      respondby: dispute.respondby,
      comments: dispute.comments,
    },
  };
}

export function normalizeRazorpayRefund(
  refund: RazorpayRefund
): NormalizedTransaction {
  let status: NormalizedTransaction["status"];
  switch (refund.status) {
    case "processed":
      status = "completed";
      break;
    case "failed":
      status = "failed";
      break;
    default:
      status = "pending";
  }

  return {
    external_id: refund.id,
    type: "debit",
    amount: refund.amount / 100,
    currency: (refund.currency ?? "INR").toUpperCase(),
    category: "refund",
    counterparty_name: null,
    description: `Refund for payment ${refund.payment_id}`,
    source: "razorpay_refund",
    status,
    transaction_date: unixToDateString(refund.created_at),
    metadata: {
      payment_id: refund.payment_id,
      receipt: refund.receipt,
      speed_processed: refund.speed_processed,
      speed_requested: refund.speed_requested,
      acquirer_data: refund.acquirer_data,
    },
  };
}

export function normalizeRazorpaySettlement(
  settlement: RazorpaySettlement
): NormalizedTransaction {
  return {
    external_id: settlement.id,
    type: "credit",
    amount: settlement.amount / 100,
    currency: "INR",
    category: "settlement",
    counterparty_name: "Razorpay",
    description: settlement.description ?? `Settlement ${settlement.utr ?? settlement.id}`,
    source: "razorpay_settlement",
    status: settlement.status === "processed" ? "completed" : "pending",
    transaction_date: unixToDateString(settlement.created_at),
    metadata: {
      fees: settlement.fees / 100,
      tax: settlement.tax / 100,
      utr: settlement.utr,
      onhold_amount: settlement.onhold_amount / 100,
    },
  };
}

// ─── Stripe normalizers ───────────────────────────────────────────────────────

export function normalizeStripeCharge(
  charge: StripeCharge
): NormalizedTransaction {
  let status: NormalizedTransaction["status"];
  if (charge.refunded && charge.amount_refunded >= charge.amount) {
    status = "refunded";
  } else if (charge.status === "succeeded") {
    status = "completed";
  } else if (charge.status === "failed") {
    status = "failed";
  } else {
    status = "pending";
  }

  let counterparty: string | null = null;
  if (charge.customer && typeof charge.customer === "object") {
    counterparty =
      charge.customer.name ?? charge.customer.email ?? null;
  }
  if (!counterparty) {
    counterparty =
      charge.billing_details?.name ?? charge.billing_details?.email ?? null;
  }

  // Stripe amounts are in smallest unit — divide by 100 for most currencies
  // (JPY and other zero-decimal currencies are already in full units, but we
  //  treat them uniformly here and normalise only when we know the currency)
  const currency = charge.currency.toUpperCase();
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency);
  const amount = isZeroDecimal ? charge.amount : charge.amount / 100;

  // Base-currency (INR) equivalent.
  //  • Already in base currency  → 1:1.
  //  • Foreign currency          → use the charge's balance transaction, which
  //    holds the amount Stripe actually settled in the account's currency
  //    (INR for an Indian account) plus the exact exchange rate. This matches
  //    the money that hit the bank — no external FX guess.
  //  • No usable balance txn     → leave null; aggregation falls back to amount.
  let amount_base: number | null = null;
  let base_currency: string | null = null;
  let fx_rate: number | null = null;
  // Stripe processing fee (from the balance transaction). It is in the account's
  // settlement currency — which equals the charge currency for a single-currency
  // account — so it's stored in the charge currency's full units; the summary
  // converts it to INR with the row's fx_rate (like the amount).
  let fee: number | null = null;
  const bt = charge.balance_transaction && typeof charge.balance_transaction === "object"
    ? charge.balance_transaction
    : null;
  if (currency === BASE_CURRENCY) {
    amount_base = amount;
    base_currency = BASE_CURRENCY;
    fx_rate = 1;
  } else if (bt && bt.currency.toUpperCase() === BASE_CURRENCY) {
    amount_base = ZERO_DECIMAL_CURRENCIES.has(bt.currency.toUpperCase()) ? bt.amount : bt.amount / 100;
    base_currency = BASE_CURRENCY;
    fx_rate = bt.exchange_rate ?? null;
  }
  if (bt && typeof bt.fee === "number") {
    fee = ZERO_DECIMAL_CURRENCIES.has(bt.currency.toUpperCase()) ? bt.fee : bt.fee / 100;
  }

  return {
    external_id: charge.id,
    type: "credit",
    amount,
    currency,
    category: null,
    counterparty_name: counterparty,
    description: charge.description ?? null,
    source: "stripe",
    status,
    transaction_date: unixToDateString(charge.created),
    amount_base,
    base_currency,
    fx_rate,
    metadata: {
      failure_code: charge.failure_code,
      failure_message: charge.failure_message,
      amount_refunded: isZeroDecimal
        ? charge.amount_refunded
        : charge.amount_refunded / 100,
      fee, // processing fee in charge currency; converted to INR at aggregation
      email: charge.billing_details?.email ?? (typeof charge.customer === "object" ? charge.customer?.email : null) ?? null,
      phone: charge.billing_details?.phone ?? null,
      stripe_metadata: charge.metadata,
    },
  };
}

export function normalizeStripePayout(
  payout: StripePayout
): NormalizedTransaction {
  let status: NormalizedTransaction["status"];
  switch (payout.status) {
    case "paid":
      status = "completed";
      break;
    case "failed":
    case "canceled":
      status = "failed";
      break;
    default:
      status = "pending";
  }

  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(
    payout.currency.toUpperCase()
  );
  const amount = isZeroDecimal ? payout.amount : payout.amount / 100;

  return {
    external_id: payout.id,
    type: "debit",
    amount,
    currency: payout.currency.toUpperCase(),
    category: null,
    counterparty_name: null,
    description: payout.description ?? null,
    source: "stripe_payout",
    status,
    transaction_date: unixToDateString(payout.created),
    metadata: {
      arrival_date: payout.arrival_date,
      stripe_metadata: payout.metadata,
    },
  };
}

export function normalizeStripeDispute(
  dispute: StripeDispute
): NormalizedTransaction {
  // A dispute (chargeback) is money at risk/lost — a real reduction, so it's a
  // debit (counts against Net Flow), category "dispute" (NOT a transfer).
  const currency = dispute.currency.toUpperCase();
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currency);
  const amount = isZeroDecimal ? dispute.amount : dispute.amount / 100;
  const status: NormalizedTransaction["status"] =
    dispute.status === "won" ? "completed" : dispute.status === "lost" ? "completed" : "pending";

  return {
    external_id: dispute.id,
    type: "debit",
    amount,
    currency,
    category: "dispute",
    counterparty_name: null,
    description: dispute.reason ? `Dispute: ${dispute.reason}` : "Dispute",
    source: "stripe_dispute",
    status,
    transaction_date: unixToDateString(dispute.created),
    metadata: {
      dispute_status: dispute.status,
      charge: dispute.charge,
      stripe_metadata: dispute.metadata,
    },
  };
}

// Zero-decimal currencies per Stripe docs
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

// ─── Cashfree raw types ───────────────────────────────────────────────────────

// Cashfree's only bulk feed is the Settlement Reconciliation report
// (POST /pg/settlement/recon) — there is NO "list orders by date" API. Each row is
// an event (payment / refund / dispute / chargeback / settlement bookkeeping).
export type CashfreeReconEvent = {
  event_details?: {
    event_id?: string;
    event_type?: string;   // PAYMENT | REFUND | DISPUTE | CHARGEBACK | *_REVERSAL | PRE_ARBITRATION | NORMAL_SETTLEMENT_CHARGE | NORMAL_SETTLEMENT_TAX | BALANCE_CARRY_OVER | OTHER_ADJUSTMENT
    event_amount?: number;
    event_currency?: string;
    event_service_charge?: number;
    event_service_tax?: number;
    event_status?: string; // SUCCESS | FAILED | PENDING | CANCELLED
    event_time?: string;   // ISO 8601 (e.g. 2026-05-27T12:44:06+05:30)
    sale_type?: string;    // CREDIT | DEBIT
    event_remarks?: string | null;
  } | null;
  order_details?: { order_id?: string; order_amount?: number; order_currency?: string } | null;
  customer_details?: { customer_name?: string | null; customer_email?: string | null; customer_phone?: string | null } | null;
  payment_details?: { cf_payment_id?: string | number; payment_amount?: number; payment_service_charge?: number; payment_service_tax?: number; payment_time?: string } | null;
  settlement_details?: { cf_settlement_id?: string | number; utr?: string | null; settlement_date?: string } | null;
  refund_details?: { refund_id?: string; refund_processed_at?: string; refund_note?: string | null } | null;
  dispute_details?: { dispute_category?: string; closed_in_favor_of?: string } | null;
};

// ─── PayU raw types ───────────────────────────────────────────────────────────

export type PayUTransaction = {
  mihpayid: string;
  txnid: string;
  amount: string;                     // e.g. "500.00"
  net_amount_debit: string | null;    // amount after deductions
  status: string;                     // success | failure | pending | refunded
  firstname: string | null;
  email: string | null;
  phone: string | null;
  productinfo: string | null;
  addedon: string;                    // "YYYY-MM-DD HH:mm:ss"
  mode: string | null;                // payment method
  bank_ref_no: string | null;
  unmappedstatus: string | null;
  discount: string | null;
};

// ─── Paytm raw types ─────────────────────────────────────────────────────────

export type PaytmTransaction = {
  orderId: string;
  txnId: string | null;
  txnAmount: string;                  // e.g. "500.00" (paise-denominated string? No — full units)
  txnDate: string;                    // "YYYY-MM-DD HH:mm:ss"
  status: string;                     // TXN_SUCCESS | TXN_FAILURE | PENDING
  paymentMode: string | null;
  bankTxnId: string | null;
  bankName: string | null;
  custId: string | null;
  responseCode: string | null;
  responseMsg: string | null;
};

// ─── Easebuzz raw types ───────────────────────────────────────────────────────

export type EasebuzzTransaction = {
  txnid: string;
  mihpayid: string | null;
  amount: string;                     // e.g. "500.00"
  net_amount_debit: string | null;
  status: string;                     // success | failure | pending
  firstname: string | null;
  email: string | null;
  phone: string | null;
  productinfo: string | null;
  addedon: string;                    // "YYYY-MM-DD HH:mm:ss"
  mode: string | null;
  bank_ref_no: string | null;
  unmappedstatus: string | null;
};

// ─── Cashfree normalizers ─────────────────────────────────────────────────────

// Settlement-level bookkeeping events (gateway fees/taxes, balance carry-over). We
// STORE + SHOW them (full transparency) under a settlement source/category so they're
// visible in Raw Data; the existing metric logic already treats *_settlement sources
// like transfers, so they don't double-count the per-payment fee in Net Flow.
const CASHFREE_SETTLEMENT_EVENTS = new Set([
  "NORMAL_SETTLEMENT_CHARGE", "NORMAL_SETTLEMENT_TAX", "BALANCE_CARRY_OVER",
]);

/** Map one Settlement-Reconciliation event to a transaction. Returns null only for a
 *  row with no event type at all — every real money/bookkeeping event is kept. */
export function normalizeCashfreeReconEvent(e: CashfreeReconEvent): NormalizedTransaction | null {
  const ev = e.event_details ?? {};
  const type = (ev.event_type ?? "").toUpperCase();
  if (!type) return null;

  // Direction from sale_type; PAYMENT is a credit by default.
  const credit = ev.sale_type ? ev.sale_type.toUpperCase() === "CREDIT" : type === "PAYMENT";

  // A PAYMENT's value is order_amount (recon leaves payment_amount = 0); every other
  // event carries its own amount in event_amount.
  const amount =
    type === "PAYMENT"
      ? Number(e.order_details?.order_amount ?? ev.event_amount ?? 0)
      : Number(ev.event_amount ?? e.order_details?.order_amount ?? 0);

  let status: NormalizedTransaction["status"];
  switch ((ev.event_status ?? "").toUpperCase()) {
    case "SUCCESS":   status = "completed"; break;
    case "FAILED":
    case "CANCELLED": status = "failed";    break;
    default:          status = "pending";
  }

  // Stable per-event id so re-syncs dedup + update in place.
  const pid = e.payment_details?.cf_payment_id;
  const externalId =
    type === "PAYMENT" && pid != null ? `cf_pay_${pid}`
    : type === "REFUND" && e.refund_details?.refund_id ? `cf_refund_${e.refund_details.refund_id}`
    : ev.event_id ? `cf_evt_${ev.event_id}`
    : `cf_${type}_${e.order_details?.order_id ?? ""}_${ev.event_time ?? ""}`;

  const isDispute = type.includes("DISPUTE") || type.includes("CHARGEBACK") || type === "PRE_ARBITRATION";
  const isSettlement = CASHFREE_SETTLEMENT_EVENTS.has(type);
  const category =
    type === "PAYMENT" ? "payment"
    : type === "REFUND" ? "refund"
    : isDispute ? "dispute"
    : isSettlement ? "settlement"
    : "adjustment";
  const source =
    type === "PAYMENT" ? "cashfree"
    : type === "REFUND" ? "cashfree_refund"
    : isDispute ? "cashfree_dispute"
    : isSettlement ? "cashfree_settlement"  // ends in _settlement → existing metric logic excludes from Net Flow (no fee double-count)
    : "cashfree_adjustment";

  // Cashfree fee for this payment = service charge + tax (full INR units).
  const fee =
    Number(ev.event_service_charge ?? e.payment_details?.payment_service_charge ?? 0) +
    Number(ev.event_service_tax ?? e.payment_details?.payment_service_tax ?? 0);

  const cust = e.customer_details;
  const when = ev.event_time ?? e.payment_details?.payment_time ?? e.settlement_details?.settlement_date ?? "";

  return {
    external_id: externalId,
    type: credit ? "credit" : "debit",
    amount,
    currency: (ev.event_currency ?? e.order_details?.order_currency ?? "INR").toUpperCase(),
    category,
    counterparty_name: cust?.customer_name ?? cust?.customer_email ?? cust?.customer_phone ?? null,
    description: ev.event_remarks ?? (e.order_details?.order_id ? `${type} · order ${e.order_details.order_id}` : type),
    source,
    status,
    transaction_date: when.slice(0, 10),
    metadata: {
      event_type: type,
      order_id: e.order_details?.order_id ?? null,
      cf_payment_id: pid ?? null,
      email: cust?.customer_email ?? null,
      phone: cust?.customer_phone ?? null,
      utr: e.settlement_details?.utr ?? null,
      ...(fee > 0 ? { fee } : {}),
    },
  };
}

// ─── Cashfree webhook payload (real-time) ─────────────────────────────────────
// The webhook payload shape differs from the recon report (data.payment / data.refund
// instead of event_details). external_ids MATCH the recon normalizer (cf_pay_…,
// cf_refund_…) so real-time webhook rows dedup cleanly against the batch backfill.
// Disputes are intentionally left to the recon backfill (different id scheme).
export type CashfreeWebhookPayload = {
  type?: string;
  event_time?: string;
  data?: {
    order?: { order_id?: string; order_amount?: number; order_currency?: string };
    payment?: {
      cf_payment_id?: string | number;
      payment_status?: string;
      payment_amount?: number;
      payment_currency?: string;
      payment_time?: string;
    };
    customer_details?: { customer_name?: string | null; customer_email?: string | null; customer_phone?: string | null };
    refund?: {
      cf_refund_id?: string | number;
      refund_id?: string;
      order_id?: string;
      refund_amount?: number;
      refund_currency?: string;
      refund_status?: string;
      processed_at?: string;
    };
  };
};

/** Map a Cashfree webhook (payment or refund) to a transaction (null otherwise). */
export function normalizeCashfreeWebhookEvent(p: CashfreeWebhookPayload): NormalizedTransaction | null {
  const type = (p.type ?? "").toUpperCase();
  const d = p.data ?? {};

  if (type.startsWith("PAYMENT_")) {
    const pay = d.payment ?? {};
    const order = d.order ?? {};
    if (pay.cf_payment_id == null) return null;
    const st = (pay.payment_status ?? "").toUpperCase();
    const status: NormalizedTransaction["status"] =
      st === "SUCCESS" ? "completed" : st === "PENDING" ? "pending" : "failed";
    const cust = d.customer_details;
    return {
      external_id: `cf_pay_${pay.cf_payment_id}`,
      type: "credit",
      amount: Number(pay.payment_amount ?? order.order_amount ?? 0),
      currency: (pay.payment_currency ?? order.order_currency ?? "INR").toUpperCase(),
      category: "payment",
      counterparty_name: cust?.customer_name ?? cust?.customer_email ?? cust?.customer_phone ?? null,
      description: order.order_id ? `Payment · order ${order.order_id}` : "Payment",
      source: "cashfree",
      status,
      transaction_date: (pay.payment_time ?? p.event_time ?? "").slice(0, 10),
      metadata: { event_type: type, order_id: order.order_id ?? null, cf_payment_id: pay.cf_payment_id, email: cust?.customer_email ?? null, phone: cust?.customer_phone ?? null },
    };
  }

  if (type.startsWith("REFUND")) {
    const r = d.refund ?? {};
    if (!r.refund_id) return null;
    const st = (r.refund_status ?? "").toUpperCase();
    const status: NormalizedTransaction["status"] =
      st === "SUCCESS" ? "completed" : st === "PENDING" || st === "ONHOLD" ? "pending" : "failed";
    return {
      external_id: `cf_refund_${r.refund_id}`,
      type: "debit",
      amount: Number(r.refund_amount ?? 0),
      currency: (r.refund_currency ?? "INR").toUpperCase(),
      category: "refund",
      counterparty_name: null,
      description: r.order_id ? `Refund · order ${r.order_id}` : "Refund",
      source: "cashfree_refund",
      status,
      transaction_date: (r.processed_at ?? p.event_time ?? "").slice(0, 10),
      metadata: { event_type: type, order_id: r.order_id ?? null, cf_refund_id: r.cf_refund_id ?? null },
    };
  }

  return null; // disputes / others → handled by the recon backfill
}

// ─── PayU normalizers ─────────────────────────────────────────────────────────

export function normalizePayUTransaction(tx: PayUTransaction): NormalizedTransaction {
  let status: NormalizedTransaction["status"];
  let type: "credit" | "debit" = "credit";
  switch (tx.status?.toLowerCase()) {
    case "success":                   status = "completed"; break;
    case "refunded":                  status = "refunded"; type = "debit"; break;
    case "failure": case "failed":    status = "failed";   break;
    default:                          status = "pending";
  }

  const amount = parseFloat(tx.amount ?? "0") || 0;
  const dateStr = tx.addedon ? tx.addedon.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const counterparty = tx.firstname ?? tx.email ?? tx.phone ?? null;

  return {
    external_id: `payu_${tx.mihpayid}`,
    type,
    amount,
    currency: "INR",
    category: null,
    counterparty_name: counterparty,
    description: tx.productinfo ?? `PayU txn ${tx.txnid}`,
    source: "payu",
    status,
    transaction_date: dateStr,
    metadata: { txnid: tx.txnid, mihpayid: tx.mihpayid, mode: tx.mode, bank_ref_no: tx.bank_ref_no, net_amount_debit: tx.net_amount_debit },
  };
}

// ─── Paytm normalizers ────────────────────────────────────────────────────────

export function normalizePaytmTransaction(tx: PaytmTransaction): NormalizedTransaction {
  let status: NormalizedTransaction["status"];
  switch (tx.status?.toUpperCase()) {
    case "TXN_SUCCESS":  status = "completed"; break;
    case "TXN_FAILURE":  status = "failed";    break;
    default:             status = "pending";
  }

  const amount = parseFloat(tx.txnAmount ?? "0") || 0;
  const dateStr = tx.txnDate ? tx.txnDate.slice(0, 10) : new Date().toISOString().slice(0, 10);

  return {
    external_id: `paytm_${tx.txnId ?? tx.orderId}`,
    type: "credit",
    amount,
    currency: "INR",
    category: null,
    counterparty_name: tx.custId ?? null,
    description: `Paytm order ${tx.orderId}`,
    source: "paytm",
    status,
    transaction_date: dateStr,
    metadata: { orderId: tx.orderId, txnId: tx.txnId, paymentMode: tx.paymentMode, bankTxnId: tx.bankTxnId, responseCode: tx.responseCode },
  };
}

// ─── Easebuzz normalizers ─────────────────────────────────────────────────────

export function normalizeEasebuzzTransaction(tx: EasebuzzTransaction): NormalizedTransaction {
  let status: NormalizedTransaction["status"];
  let type: "credit" | "debit" = "credit";
  switch (tx.status?.toLowerCase()) {
    case "success":                   status = "completed"; break;
    case "refunded":                  status = "refunded"; type = "debit"; break;
    case "failure": case "failed":    status = "failed";   break;
    default:                          status = "pending";
  }

  const amount = parseFloat(tx.amount ?? "0") || 0;
  const dateStr = tx.addedon ? tx.addedon.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const counterparty = tx.firstname ?? tx.email ?? tx.phone ?? null;

  return {
    external_id: `eb_${tx.txnid}`,
    type,
    amount,
    currency: "INR",
    category: null,
    counterparty_name: counterparty,
    description: tx.productinfo ?? `Easebuzz txn ${tx.txnid}`,
    source: "easebuzz",
    status,
    transaction_date: dateStr,
    metadata: { txnid: tx.txnid, mihpayid: tx.mihpayid, mode: tx.mode, bank_ref_no: tx.bank_ref_no, net_amount_debit: tx.net_amount_debit },
  };
}

// ─── CSV / Excel normalizer ───────────────────────────────────────────────────

export function normalizeCsvRow(
  row: Record<string, string>,
  mapping: CsvColumnMapping
): NormalizedTransaction {
  const rawDate = row[mapping.dateCol] ?? "";
  const rawAmount = row[mapping.amountCol] ?? "0";
  const rawType = mapping.typeCol ? (row[mapping.typeCol] ?? "").toLowerCase() : null;
  const description = mapping.descriptionCol
    ? (row[mapping.descriptionCol] ?? null)
    : null;
  const counterparty = mapping.counterpartyCol
    ? (row[mapping.counterpartyCol] ?? null)
    : null;
  const currency = mapping.currencyCol
    ? ((row[mapping.currencyCol] ?? "INR").toUpperCase())
    : "INR";

  // Amount: strip currency symbols, commas, spaces
  const cleanedAmount = rawAmount.replace(/[^0-9.\-]/g, "");
  const parsedAmount = parseFloat(cleanedAmount);
  const absoluteAmount = Math.abs(isNaN(parsedAmount) ? 0 : parsedAmount);

  // Determine type
  let txType: "credit" | "debit";
  if (rawType) {
    txType =
      rawType.includes("credit") || rawType.includes("cr") || rawType === "in"
        ? "credit"
        : "debit";
  } else {
    // Negative amount means debit
    txType = parsedAmount < 0 ? "debit" : "credit";
  }

  return {
    external_id: null,
    type: txType,
    amount: absoluteAmount,
    currency,
    category: null,
    counterparty_name: counterparty && counterparty.trim() ? counterparty.trim() : null,
    description: description && description.trim() ? description.trim() : null,
    source: "csv",
    status: "completed",
    transaction_date: parseDateString(rawDate),
    metadata: { raw: row },
  };
}
