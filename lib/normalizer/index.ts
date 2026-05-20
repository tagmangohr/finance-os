import { parse, isValid } from "date-fns";

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
  return new Date(ts * 1000).toISOString().slice(0, 10);
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
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(
    charge.currency.toUpperCase()
  );
  const amount = isZeroDecimal ? charge.amount : charge.amount / 100;

  return {
    external_id: charge.id,
    type: "credit",
    amount,
    currency: charge.currency.toUpperCase(),
    category: null,
    counterparty_name: counterparty,
    description: charge.description ?? null,
    source: "stripe",
    status,
    transaction_date: unixToDateString(charge.created),
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
