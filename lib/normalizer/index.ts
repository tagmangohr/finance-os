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
  if (currency === BASE_CURRENCY) {
    amount_base = amount;
    base_currency = BASE_CURRENCY;
    fx_rate = 1;
  } else if (charge.balance_transaction && typeof charge.balance_transaction === "object") {
    const bt = charge.balance_transaction;
    const btCurrency = bt.currency.toUpperCase();
    if (btCurrency === BASE_CURRENCY) {
      amount_base = ZERO_DECIMAL_CURRENCIES.has(btCurrency) ? bt.amount : bt.amount / 100;
      base_currency = BASE_CURRENCY;
      fx_rate = bt.exchange_rate ?? null;
    }
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

export type CashfreeOrder = {
  cf_order_id: number | string;
  order_id: string;
  order_amount: number;               // full INR units
  order_currency: string;
  order_status: string;               // ACTIVE | PAID | EXPIRED | CANCELLED
  order_note: string | null;
  customer_details: {
    customer_name: string | null;
    customer_email: string | null;
    customer_phone: string | null;
  } | null;
  created_at: string;                 // ISO 8601
};

export type CashfreeSettlement = {
  cf_settlement_id: number | string;
  settlement_currency: string;
  settlement_amount: number;          // full INR units
  order_id: string;
  order_amount: number;
  service_charge: number;
  service_tax: number;
  order_settled_time: string;         // ISO 8601
  transfer_utr: string | null;
};

export type CashfreeRefund = {
  cf_refund_id: string;
  order_id: string;
  refund_amount: number;              // full INR units
  refund_currency: string;
  refund_status: string;              // SUCCESS | PENDING | CANCELLED | ONHOLD
  refund_note: string | null;
  created_at: string;                 // ISO 8601
  cf_payment_id: number | string;
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

export function normalizeCashfreeOrder(order: CashfreeOrder): NormalizedTransaction {
  let status: NormalizedTransaction["status"];
  switch (order.order_status?.toUpperCase()) {
    case "PAID":       status = "completed"; break;
    case "EXPIRED":
    case "CANCELLED":  status = "failed";    break;
    default:           status = "pending";
  }

  const cust = order.customer_details;
  const counterparty = cust?.customer_name ?? cust?.customer_email ?? cust?.customer_phone ?? null;

  return {
    external_id: `cf_order_${order.cf_order_id}`,
    type: "credit",
    amount: order.order_amount,
    currency: (order.order_currency ?? "INR").toUpperCase(),
    category: null,
    counterparty_name: counterparty,
    description: order.order_note ?? `Order ${order.order_id}`,
    source: "cashfree",
    status,
    transaction_date: order.created_at.slice(0, 10),
    metadata: { order_id: order.order_id, cf_order_id: order.cf_order_id },
  };
}

export function normalizeCashfreeSettlement(s: CashfreeSettlement): NormalizedTransaction {
  return {
    external_id: `cf_settlement_${s.cf_settlement_id}`,
    type: "credit",
    amount: s.settlement_amount,
    currency: (s.settlement_currency ?? "INR").toUpperCase(),
    category: "settlement",
    counterparty_name: "Cashfree",
    description: `Settlement for order ${s.order_id}${s.transfer_utr ? ` · UTR ${s.transfer_utr}` : ""}`,
    source: "cashfree_settlement",
    status: "completed",
    transaction_date: s.order_settled_time.slice(0, 10),
    metadata: { order_id: s.order_id, order_amount: s.order_amount, service_charge: s.service_charge, service_tax: s.service_tax, utr: s.transfer_utr },
  };
}

export function normalizeCashfreeRefund(r: CashfreeRefund): NormalizedTransaction {
  let status: NormalizedTransaction["status"];
  switch (r.refund_status?.toUpperCase()) {
    case "SUCCESS":  status = "completed"; break;
    case "CANCELLED": status = "failed";  break;
    default:         status = "pending";
  }
  return {
    external_id: `cf_refund_${r.cf_refund_id}`,
    type: "debit",
    amount: r.refund_amount,
    currency: (r.refund_currency ?? "INR").toUpperCase(),
    category: "refund",
    counterparty_name: null,
    description: r.refund_note ?? `Refund for order ${r.order_id}`,
    source: "cashfree_refund",
    status,
    transaction_date: r.created_at.slice(0, 10),
    metadata: { order_id: r.order_id, cf_payment_id: r.cf_payment_id },
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
