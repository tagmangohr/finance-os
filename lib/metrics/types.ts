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
 *  paginated fallback). All money is base currency (INR). */
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
