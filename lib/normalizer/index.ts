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
  transaction_at?: string | null; // full UTC ISO timestamp (the precise transaction time)
  // Non-null for recurring/subscription charges (the gateway subscription id). Written
  // to the durable transactions.subscription_id column on INSERT; the recon/one-time
  // refresh path never clears it, so the recurring signal survives re-syncs.
  subscription_id?: string | null;
  metadata: Record<string, unknown>;
  // The COMPLETE, unmodified source payload for this row (the gateway object /
  // webhook body / CSV row we normalized from). Persisted verbatim to the `raw`
  // jsonb column so any field we don't surface today becomes a display-only change
  // later — never a re-fetch. Curated `metadata` above stays the indexed/searchable
  // subset; `raw` is the full record. Optional only so older call sites still compile.
  raw?: unknown;
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

// Full transaction timestamp as a UTC ISO string (for the precise Time column).
// Unlike transaction_date (date-only), this preserves the time the gateway reported.
function unixToIso(ts: number): string {
  return new Date(ts * 1000).toISOString();
}

// Parse a gateway datetime string to a UTC ISO string. Strings carrying a tz
// offset (e.g. Cashfree "…+05:30") are respected; bare "YYYY-MM-DD HH:mm:ss"
// values (PayU/Paytm/Easebuzz) are IST, so we tag them +05:30 before converting.
function gatewayTimeToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  const hasTz = /([zZ]|[+-]\d{2}:?\d{2})$/.test(t);
  const d = new Date(hasTz ? t : `${t.replace(" ", "T")}+05:30`);
  if (isNaN(d.getTime())) return null;
  // Reject implausible sentinel dates (e.g. Cashfree returns respond_by/date =
  // "9999-09-08" for open disputes with no deadline). A garbage far-future date
  // would otherwise pollute every date-windowed metric. Anything outside a sane
  // range is treated as "unknown" so callers fall back to a real timestamp.
  const y = d.getUTCFullYear();
  if (y < 2000 || y > new Date().getUTCFullYear() + 1) return null;
  return d.toISOString();
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

// Apple reports timestamps in MILLISECONDS since the epoch (not seconds like the
// gateways). Same IST convention for the date-only column.
function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}
function msToDateString(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
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
    transaction_at: unixToIso(payment.created_at),
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
    raw: payment,
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
    transaction_at: unixToIso(payout.created_at),
    metadata: {
      fund_account_id: payout.fund_account_id,
      mode: payout.mode,
      fees: payout.fees / 100,
      tax: payout.tax / 100,
      processed_at: payout.processed_at,
      notes: payout.notes,
    },
    raw: payout,
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
    transaction_at: unixToIso(dispute.created_at),
    metadata: {
      payment_id: dispute.payment_id,
      phase: dispute.phase,
      reason_code: dispute.reason_code,
      reason_description: dispute.reason_description,
      respondby: dispute.respondby,
      comments: dispute.comments,
    },
    raw: dispute,
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
    transaction_at: unixToIso(refund.created_at),
    metadata: {
      payment_id: refund.payment_id,
      receipt: refund.receipt,
      speed_processed: refund.speed_processed,
      speed_requested: refund.speed_requested,
      acquirer_data: refund.acquirer_data,
    },
    raw: refund,
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
    transaction_at: unixToIso(settlement.created_at),
    metadata: {
      fees: settlement.fees / 100,
      tax: settlement.tax / 100,
      utr: settlement.utr,
      onhold_amount: settlement.onhold_amount / 100,
    },
    raw: settlement,
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
    transaction_at: unixToIso(charge.created),
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
    raw: charge,
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
    transaction_at: unixToIso(payout.created),
    metadata: {
      arrival_date: payout.arrival_date,
      stripe_metadata: payout.metadata,
    },
    raw: payout,
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
    transaction_at: unixToIso(dispute.created),
    metadata: {
      dispute_status: dispute.status,
      charge: dispute.charge,
      stripe_metadata: dispute.metadata,
    },
    raw: dispute,
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

  // Disputes are owned by the real-time webhook (keyed by a stable dispute_id).
  // Recon has no dispute_id, so emitting disputes here would create duplicate
  // dispute rows under a different id. Skip them — the webhook is the sole source.
  if (type.includes("DISPUTE") || type.includes("CHARGEBACK") || type === "PRE_ARBITRATION") return null;

  // Direction from sale_type; PAYMENT is a credit by default.
  const credit = ev.sale_type ? ev.sale_type.toUpperCase() === "CREDIT" : type === "PAYMENT";

  // Amount = event_amount, the ACTUAL money moved for this event (payments,
  // refunds, everything). Do NOT use order_amount for a PAYMENT: order_amount is the
  // order's face value, which can exceed what was actually captured — e.g. a partial
  // / underpayment (order created for ₹53,100 but only ₹1 paid) still settles as
  // order_status=PAID, and booking order_amount overstates revenue by the shortfall.
  // event_amount is ₹1 there (event_settlement_amount ₹0.99 + service_charge ₹0.01),
  // and equals order_amount for the normal fully-paid case. order_amount is only a
  // fallback for the rare row missing event_amount. (payment_details.payment_amount
  // is always null in recon, so it's not usable here.)
  const amount = Number(ev.event_amount ?? e.order_details?.order_amount ?? 0);

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
    transaction_at: gatewayTimeToIso(when),
    metadata: {
      event_type: type,
      order_id: e.order_details?.order_id ?? null,
      cf_payment_id: pid ?? null,
      email: cust?.customer_email ?? null,
      phone: cust?.customer_phone ?? null,
      utr: e.settlement_details?.utr ?? null,
      ...(fee > 0 ? { fee } : {}),
    },
    raw: e,
  };
}

// ─── Cashfree webhook payload (real-time) ─────────────────────────────────────
// The webhook payload shape differs from the recon report (data.payment / data.refund
// instead of event_details). Payment/refund external_ids MATCH the recon normalizer
// (cf_pay_…, cf_refund_…) so they dedup cleanly against the batch backfill.
// Disputes are keyed by their stable dispute_id (cf_dispute_<id>); recon does NOT
// emit disputes (it has no dispute_id), so the webhook is their sole source.
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
    // Dispute / chargeback events (DISPUTE_CREATED | DISPUTE_UPDATED | DISPUTE_CLOSED).
    dispute?: {
      dispute_id?: string | number;
      cf_dispute_id?: string | number; // the disputes LIST API names it cf_dispute_id; treat as canonical
      dispute_type?: string;          // DISPUTE | CHARGEBACK | PRE_ARBITRATION | ARBITRATION | RETRIEVAL
      reason_code?: string | null;
      reason_description?: string | null;
      dispute_amount?: number;
      dispute_amount_currency?: string;
      dispute_status?: string;        // e.g. DISPUTE_CREATED, CHARGEBACK_MERCHANT_WON, *_MERCHANT_LOST
      created_at?: string;
      updated_at?: string;
      respond_by?: string;
      resolved_at?: string;
    };
    order_details?: { order_id?: string; cf_payment_id?: string | number; order_amount?: number; order_currency?: string };
    // Recurring / subscription events (SUBSCRIPTION_* — see normalizeCashfreeSubscriptionEvent).
    // Cashfree nests the subscription entity and, on charge events, the individual payment.
    subscription?: {
      subscription_id?: string;
      subscription_reference_id?: string;   // some payloads name it this
      subscription_status?: string;         // ACTIVE | CANCELLED | COMPLETED | BANK_APPROVAL_PENDING | ...
      customer_name?: string | null;
      customer_email?: string | null;
      customer_phone?: string | null;
      plan_name?: string | null;
      plan_amount?: number | null;
      subscription_amount?: number | null;
      currency?: string | null;
      first_charge_time?: string | null;
      next_charge_time?: string | null;
    };
    subscription_payment?: {
      cf_payment_id?: string | number;
      payment_id?: string | number;
      payment_amount?: number;
      payment_currency?: string;
      payment_status?: string;              // SUCCESS | FAILED | CANCELLED | PENDING
      payment_time?: string;
      failure_reason?: string | null;
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
      transaction_at: gatewayTimeToIso(pay.payment_time ?? p.event_time),
      metadata: { event_type: type, order_id: order.order_id ?? null, cf_payment_id: pay.cf_payment_id, email: cust?.customer_email ?? null, phone: cust?.customer_phone ?? null },
      raw: p,
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
      transaction_at: gatewayTimeToIso(r.processed_at ?? p.event_time),
      metadata: { event_type: type, order_id: r.order_id ?? null, cf_refund_id: r.cf_refund_id ?? null },
      raw: p,
    };
  }

  if (type.startsWith("DISPUTE")) {
    const disp = d.dispute ?? {};
    const disputeId = disp.cf_dispute_id ?? disp.dispute_id; // cf_dispute_id is canonical
    if (disputeId == null) return null;
    const od = d.order_details ?? {};
    const cust = d.customer_details;
    // dispute_status carries the outcome, e.g. CHARGEBACK_MERCHANT_WON / *_MERCHANT_LOST.
    const st = (disp.dispute_status ?? "").toUpperCase();
    const status: NormalizedTransaction["status"] =
      st.includes("WON") ? "completed"
      : (st.includes("LOST") || st.includes("ACCEPTED") || st.includes("INSUFFICIENT")) ? "failed"
      : "pending"; // created / docs_received / under_review → still open
    // resolved_at on close, else the most recent timestamp we have. Each candidate
    // is validated (gatewayTimeToIso rejects sentinels like 9999-…); fall through
    // to a real timestamp, and to "now" only if every candidate is missing/garbage.
    const whenIso =
      gatewayTimeToIso(disp.resolved_at) || gatewayTimeToIso(disp.updated_at) ||
      gatewayTimeToIso(disp.created_at) || gatewayTimeToIso(p.event_time);
    const kind = (disp.dispute_type ?? "Dispute").replace(/_/g, " ");
    return {
      external_id: `cf_dispute_${disputeId}`,
      type: "debit",
      amount: Number(disp.dispute_amount ?? od.order_amount ?? 0),
      currency: (disp.dispute_amount_currency || od.order_currency || "INR").toUpperCase(),
      category: "dispute",
      counterparty_name: cust?.customer_name ?? cust?.customer_email ?? cust?.customer_phone ?? null,
      description: `${kind}${disp.reason_description ? ` · ${disp.reason_description}` : ""}${od.order_id ? ` · order ${od.order_id}` : ""}`,
      source: "cashfree_dispute",
      status,
      transaction_date: (whenIso ?? new Date().toISOString()).slice(0, 10),
      transaction_at: whenIso,
      metadata: {
        event_type: type,
        dispute_id: disputeId,
        dispute_type: disp.dispute_type ?? null,
        dispute_status: disp.dispute_status ?? null,
        reason_code: disp.reason_code ?? null,
        reason_description: disp.reason_description ?? null,
        respond_by: disp.respond_by ?? null,
        order_id: od.order_id ?? null,
        cf_payment_id: od.cf_payment_id ?? null,
        email: cust?.customer_email ?? null,
        phone: cust?.customer_phone ?? null,
      },
      raw: p,
    };
  }

  if (type.startsWith("SUBSCRIPTION")) {
    // Recurring charges. Lifecycle-only events (status change, auth, expiry reminder,
    // notification initiated) carry no money and return null here — but the webhook
    // route still upserts them into the subscription registry via
    // extractCashfreeSubscription(). Only charge events become transactions.
    return normalizeCashfreeSubscriptionPayment(p);
  }

  return null; // other event types → ignored
}

/**
 * Map a Cashfree SUBSCRIPTION_* webhook to a recurring-charge transaction, or null
 * for lifecycle-only events (no payment in the payload). Money rows use
 * source = "cashfree_subscription" and external_id "cf_subpay_<cf_payment_id>" so
 * they dedup against the settlement-recon backfill and each other.
 */
export function normalizeCashfreeSubscriptionPayment(p: CashfreeWebhookPayload): NormalizedTransaction | null {
  const type = (p.type ?? "").toUpperCase();
  const d = p.data ?? {};
  const sp = d.subscription_payment;
  const sub = d.subscription ?? {};
  // No payment object → lifecycle-only event (STATUS_CHANGED, AUTH_STATUS, …). Not a money row.
  if (!sp) return null;
  const payId = sp.cf_payment_id ?? sp.payment_id;
  if (payId == null) return null;

  const st = (sp.payment_status ?? "").toUpperCase();
  const status: NormalizedTransaction["status"] =
    st === "SUCCESS" ? "completed" : st === "PENDING" ? "pending" : "failed";
  const subId = sub.subscription_id ?? sub.subscription_reference_id ?? null;

  return {
    // SAME identity as the one-time webhook + settlement recon for this cf_payment_id
    // (source "cashfree", external_id "cf_pay_<id>") so the three paths dedup onto ONE
    // row — never double-counting a recurring charge. The recurring signal lives in the
    // durable `subscription_id` column, which the recon refresh never overwrites.
    external_id: `cf_pay_${payId}`,
    type: "credit",
    amount: Number(sp.payment_amount ?? sub.subscription_amount ?? sub.plan_amount ?? 0),
    currency: (sp.payment_currency ?? sub.currency ?? "INR").toUpperCase(),
    category: "payment", // recurring revenue — same revenue category as one-time payments
    counterparty_name: sub.customer_name ?? sub.customer_email ?? sub.customer_phone ?? null,
    description: subId ? `Subscription payment · ${subId}` : "Subscription payment",
    source: "cashfree",
    status,
    transaction_date: (sp.payment_time ?? p.event_time ?? "").slice(0, 10),
    transaction_at: gatewayTimeToIso(sp.payment_time ?? p.event_time),
    subscription_id: subId ? String(subId) : null,
    metadata: {
      event_type: type,
      subscription_id: subId,
      cf_payment_id: payId,
      plan_name: sub.plan_name ?? null,
      failure_reason: sp.failure_reason ?? null,
      email: sub.customer_email ?? null,
      phone: sub.customer_phone ?? null,
    },
    raw: p,
  };
}

/**
 * Extract the subscription registry record from ANY SUBSCRIPTION_* webhook (charge
 * or lifecycle). Returns null when the payload carries no subscription_id. The
 * webhook route upserts this into `cashfree_subscriptions` so the poller has the
 * full set of subscription_ids to re-fetch (Cashfree has no list-subscriptions API).
 */
export type CashfreeSubscriptionRecord = {
  subscription_id: string;
  status: string | null;
  plan_name: string | null;
  plan_amount: number | null;
  currency: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  next_charge_at: string | null;
  event_type: string;
  raw: unknown;
};

export function extractCashfreeSubscription(p: CashfreeWebhookPayload): CashfreeSubscriptionRecord | null {
  const type = (p.type ?? "").toUpperCase();
  if (!type.startsWith("SUBSCRIPTION")) return null;
  const sub = p.data?.subscription;
  const subId = sub?.subscription_id ?? sub?.subscription_reference_id;
  if (!sub || !subId) return null;
  return {
    subscription_id: String(subId),
    status: sub.subscription_status ?? null,
    plan_name: sub.plan_name ?? null,
    plan_amount: sub.plan_amount ?? sub.subscription_amount ?? null,
    currency: sub.currency ?? null,
    customer_name: sub.customer_name ?? null,
    customer_email: sub.customer_email ?? null,
    customer_phone: sub.customer_phone ?? null,
    next_charge_at: gatewayTimeToIso(sub.next_charge_time) ?? null,
    event_type: type,
    raw: p,
  };
}

/**
 * Normalize ONE payment object from GET /pg/subscriptions/{id}/payments (the poller
 * path — Layer 2's self-healing net). The API shape differs from the webhook, so we
 * read several likely field names defensively and keep the full object as `raw`.
 * Same external_id scheme as the webhook (cf_subpay_<cf_payment_id>) so the two paths
 * dedup against each other. Returns null if there's no usable payment id.
 */
export type CashfreeSubscriptionApiPayment = {
  cf_payment_id?: string | number;
  payment_id?: string | number;
  subscription_payment_id?: string | number;
  payment_amount?: number;
  amount?: number;
  payment_currency?: string;
  currency?: string;
  payment_status?: string;   // SUCCESS | FAILED | PENDING | ...
  status?: string;
  payment_time?: string;
  scheduled_on?: string;
  failure_reason?: string | null;
};

export function normalizeCashfreeSubscriptionApiPayment(
  pay: CashfreeSubscriptionApiPayment,
  ctx: { subscriptionId: string; planName?: string | null; customerName?: string | null; currency?: string | null }
): NormalizedTransaction | null {
  const payId = pay.cf_payment_id ?? pay.payment_id ?? pay.subscription_payment_id;
  if (payId == null) return null;
  const st = (pay.payment_status ?? pay.status ?? "").toUpperCase();
  const status: NormalizedTransaction["status"] =
    st === "SUCCESS" || st === "PAID" ? "completed" : st === "PENDING" || st === "INITIALIZED" ? "pending" : "failed";
  const whenIso = gatewayTimeToIso(pay.payment_time ?? pay.scheduled_on);
  return {
    // Same identity as recon (source "cashfree", cf_pay_<id>) — dedups, never double-counts.
    external_id: `cf_pay_${payId}`,
    type: "credit",
    amount: Number(pay.payment_amount ?? pay.amount ?? 0),
    currency: (pay.payment_currency ?? pay.currency ?? ctx.currency ?? "INR").toUpperCase(),
    category: "payment",
    counterparty_name: ctx.customerName ?? null,
    description: `Subscription payment · ${ctx.subscriptionId}`,
    source: "cashfree",
    status,
    transaction_date: (whenIso ?? new Date().toISOString()).slice(0, 10),
    transaction_at: whenIso,
    subscription_id: ctx.subscriptionId,
    metadata: {
      subscription_id: ctx.subscriptionId,
      cf_payment_id: payId,
      plan_name: ctx.planName ?? null,
      failure_reason: pay.failure_reason ?? null,
      via: "subscription_poll",
    },
    raw: pay,
  };
}

// ─── Apple App Store normalizers ──────────────────────────────────────────────
// App Store Server Notifications V2. The money lives in the decoded
// `signedTransactionInfo` (a JWSTransactionDecodedPayload). We map only the
// notifications that represent a money movement; lifecycle-only notifications
// (renewal-pref changes, expirations, price-increase consent, TEST, …) return
// null and are logged as "ignored".
//
// KEY: dedup by transactionId. A refund/revocation for a transaction carries the
// SAME transactionId as the original purchase, so it COLLAPSES onto that row and
// flips its status to "refunded" — exactly how a fully-refunded Stripe charge is
// handled (same external_id, status refunded, still a credit). Apple also retries
// delivery, so keying on transactionId makes re-delivery idempotent.

// Subset of Apple's JWSTransactionDecodedPayload we consume. Structurally
// compatible with @apple/app-store-server-library's type (kept local so the pure
// normalizer doesn't hard-depend on the SDK).
export type AppStoreTransactionInfo = {
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  subscriptionGroupIdentifier?: string;
  purchaseDate?: number;            // ms epoch
  originalPurchaseDate?: number;    // ms epoch
  expiresDate?: number;             // ms epoch
  signedDate?: number;              // ms epoch
  revocationDate?: number;          // ms epoch — set when refunded/revoked
  revocationReason?: number;
  quantity?: number;
  type?: string;                    // "Auto-Renewable Subscription" | "Non-Consumable" | …
  transactionReason?: string;       // "PURCHASE" | "RENEWAL"
  inAppOwnershipType?: string;
  offerType?: number;
  offerIdentifier?: string;
  environment?: string;             // "Sandbox" | "Production"
  storefront?: string;              // ISO-3166 alpha-3
  storefrontId?: string;
  currency?: string;                // ISO 4217, e.g. "USD" | "INR"
  price?: number;                   // in MILLIUNITS of `currency` (÷1000 → units)
  appAccountToken?: string;
};

// Notifications that book a fresh charge (each a distinct transactionId).
const APPSTORE_MONEY_IN = new Set(["SUBSCRIBED", "DID_RENEW", "ONE_TIME_CHARGE", "OFFER_REDEEMED"]);
// Notifications that reverse money on an existing transaction.
const APPSTORE_REVERSAL = new Set(["REFUND", "REVOKE"]);
// Notifications that restore a previously-reversed transaction to good standing.
const APPSTORE_RESTORE = new Set(["REFUND_REVERSED", "REFUND_DECLINED"]);

/**
 * Map one App Store notification's transaction to a NormalizedTransaction.
 * Returns null for lifecycle-only notifications (no money moved) and for a
 * payload missing a transactionId.
 */
export function normalizeAppStoreTransaction(
  txn: AppStoreTransactionInfo,
  ctx: { notificationType?: string; subtype?: string }
): NormalizedTransaction | null {
  const nt = (ctx.notificationType ?? "").toUpperCase();
  const txId = txn.transactionId;
  if (!txId) return null;

  const isRestore = APPSTORE_RESTORE.has(nt);
  const isReversal = !isRestore && (APPSTORE_REVERSAL.has(nt) || txn.revocationDate != null);
  const isMoneyIn = APPSTORE_MONEY_IN.has(nt);
  // Lifecycle-only (no money movement, no reversal) → let the caller log it as ignored.
  if (!isRestore && !isReversal && !isMoneyIn) return null;

  // Refund/revoke → refunded; everything else (purchase, renewal, refund reversed) → completed.
  const status: NormalizedTransaction["status"] = isReversal ? "refunded" : "completed";

  // price is in milliunits of `currency` (e.g. 9990 → 9.99). It's always the
  // ORIGINAL transaction's price, including on a refund — so a refunded row keeps
  // the sale amount and only flips status, matching the Stripe charge treatment.
  const amount = txn.price != null ? txn.price / 1000 : 0;
  const currency = (txn.currency ?? "USD").toUpperCase();

  // Economic date = the purchase date (unchanged by a later refund, so re-syncs
  // don't churn the date). Fall back to the JWS signed date if absent.
  const whenMs = txn.purchaseDate ?? txn.signedDate;

  return {
    external_id: `appstore_${txId}`,
    type: "credit",
    amount,
    currency,
    category: null,
    counterparty_name: null, // Apple provides no customer PII (only appAccountToken)
    description: `${nt}${txn.productId ? ` · ${txn.productId}` : ""}`,
    source: "app_store",
    status,
    transaction_date: whenMs != null ? msToDateString(whenMs) : parseDateString(""),
    transaction_at: whenMs != null ? msToIso(whenMs) : null,
    // Foreign-currency rows leave amount_base unset — persistTransactions'
    // enrichRowsWithFx converts to INR via ECB (INR rows go 1:1 in toInsertRows).
    metadata: {
      notification_type: nt,
      subtype: ctx.subtype ?? null,
      product_id: txn.productId ?? null,
      transaction_id: txId,
      original_transaction_id: txn.originalTransactionId ?? null,
      transaction_reason: txn.transactionReason ?? null,
      subscription_group: txn.subscriptionGroupIdentifier ?? null,
      offer_type: txn.offerType ?? null,
      offer_identifier: txn.offerIdentifier ?? null,
      quantity: txn.quantity ?? null,
      environment: txn.environment ?? null,
      storefront: txn.storefront ?? null,
      app_account_token: txn.appAccountToken ?? null,
      ...(isReversal ? { revocation_reason: txn.revocationReason ?? null, revocation_date: txn.revocationDate ?? null } : {}),
    },
    raw: txn,
  };
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
    transaction_at: gatewayTimeToIso(tx.addedon),
    metadata: { txnid: tx.txnid, mihpayid: tx.mihpayid, mode: tx.mode, bank_ref_no: tx.bank_ref_no, net_amount_debit: tx.net_amount_debit, email: tx.email ?? null, phone: tx.phone ?? null },
    raw: tx,
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
    transaction_at: gatewayTimeToIso(tx.txnDate),
    metadata: { orderId: tx.orderId, txnId: tx.txnId, paymentMode: tx.paymentMode, bankTxnId: tx.bankTxnId, responseCode: tx.responseCode },
    raw: tx,
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
    transaction_at: gatewayTimeToIso(tx.addedon),
    metadata: { txnid: tx.txnid, mihpayid: tx.mihpayid, mode: tx.mode, bank_ref_no: tx.bank_ref_no, net_amount_debit: tx.net_amount_debit, email: tx.email ?? null, phone: tx.phone ?? null },
    raw: tx,
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
    raw: row,
  };
}
