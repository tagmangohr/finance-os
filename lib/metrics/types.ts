import type { LucideIcon } from "lucide-react";

/** One transaction-month bucket (ascending order in MetricData.monthly). */
export type MonthlyPoint = {
  month: string;   // "YYYY-MM"
  gross: number;   // credit revenue (completed + refunded), INR
  net: number;     // gross − refunds
  refunds: number; // refund debits + refunded-status credits
  expense: number; // non-refund/dispute/transfer debits (≈0 until expense data lands)
  txns: number;    // completed credit count
  customers: number; // distinct paying counterparties (completed credits)
};

/** Everything the metric registry needs, pre-aggregated in Postgres (or the
 *  paginated fallback). All money is base currency (INR).
 *  `health` + `customers` are scoped to the SELECTED range; `monthly` stays a
 *  trailing ~13-month series (run-rate / growth are "as of now", not range-based). */
export type MetricData = {
  monthly: MonthlyPoint[];
  health: {
    completed: number; failed: number; pending: number; refunded: number;
    grossVolume: number; netCompletedVolume: number; refundAmount: number;
    disputeCount: number; disputeAmount: number;
  };
  customers: { paying: number; netRevenue: number; txns: number };
  totals: { lifetimeInflow: number; lifetimeOutflow: number };
  hasExpenses: boolean;
  source: "views" | "fallback";
  /** Real cash on hand from a linked bank (Mercury), in INR. Present only when a bank
   *  is connected; when absent, cash metrics fall back to the lifetime-net proxy. */
  bankCash?: { cashBase: number; hasData: boolean } | null;
  /** Short label of the selected range (e.g. "This FY") — shown on range-scoped cards. */
  rangeLabel?: string;
  /** Like-for-like MoM: net revenue month-to-date vs the SAME number of days in the
   *  prior month, so the growth % is honest mid-month. Includes bank-collected
   *  customer-payment revenue, so it moves in step with the Revenue card. */
  mtd?: { current: number; prior: number };
  /** Bank-collected customer-payment revenue over the SELECTED range (ledger='bank',
   *  pnl_treatment='income', category='customer_payment'), the piece the P&L counts
   *  as revenue but the gateway rollup doesn't. Added on top of health.grossVolume so
   *  "Revenue" matches the P&L. 0 until migration 123 is applied. */
  bankRevenue?: number;
};

export const EMPTY_METRIC_DATA: MetricData = {
  monthly: [],
  health: { completed: 0, failed: 0, pending: 0, refunded: 0, grossVolume: 0, netCompletedVolume: 0, refundAmount: 0, disputeCount: 0, disputeAmount: 0 },
  customers: { paying: 0, netRevenue: 0, txns: 0 },
  totals: { lifetimeInflow: 0, lifetimeOutflow: 0 },
  hasExpenses: false,
  source: "fallback",
};

export type MetricGroup = "revenue" | "payments" | "customers" | "cash";

export const METRIC_GROUPS: { key: MetricGroup; label: string }[] = [
  { key: "revenue", label: "Revenue & growth" },
  { key: "payments", label: "Payment health" },
  { key: "customers", label: "Customers & retention" },
  { key: "cash", label: "Cash, burn & profit" },
];

export type MetricFormat = "currency" | "currencyPerMonth" | "percent" | "number" | "duration";

/** What data a metric needs to be meaningful. Metrics whose requirement isn't met
 *  render an "awaiting data" state instead of a misleading 0. */
export type MetricRequires = "payments" | "expenses" | "subscriptions";

export type ComputedMetric = {
  value: number | null;
  display: string;
  trend?: number | null;      // signed % for the MetricCard arrow
  trendLabel?: string;
  spark?: number[];
  available: boolean;         // false → show the "awaiting data" state
  note?: string;              // shown when unavailable (e.g. "Connect expenses")
  /** Time-window tag shown on the card so every number is anchored, e.g. the
   *  selected range for range-scoped metrics, or "run-rate" / "live" / "YTD". */
  period?: string;
};

export type MetricDef = {
  key: string;
  label: string;
  group: MetricGroup;
  format: MetricFormat;
  description: string;
  requires: MetricRequires;
  accent: string;             // CSS color, e.g. "hsl(var(--metric-revenue))"
  icon: LucideIcon;
  compute: (d: MetricData) => ComputedMetric;
};
