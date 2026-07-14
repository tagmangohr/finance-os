import type { MetricData, MonthlyPoint } from "./types";

// Rich sample so the dashboard (and every metric, including the expense-dependent
// ones) looks fully alive in the pre-connect preview. Never shown once a real
// source is connected.
const SAMPLE_MONTHLY: MonthlyPoint[] = (() => {
  const base = [520, 560, 540, 600, 640, 700, 680, 720, 760, 790, 800, 820, 300]; // ₹K net, last is partial
  const now = new Date();
  return base.map((k, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (12 - i), 1));
    const net = k * 1000;
    const refunds = Math.round(net * 0.03);
    const expense = Math.round(net * 0.62);
    return {
      month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      gross: net + refunds,
      refunds,
      net,
      expense,
      txns: Math.round(net / 6400),
      customers: Math.round(net / 6400),
    };
  });
})();

export const SAMPLE_METRIC_DATA: MetricData = {
  monthly: SAMPLE_MONTHLY,
  health: {
    completed: 1284, failed: 96, pending: 12, refunded: 38,
    grossVolume: 24_500_000, netCompletedVolume: 23_800_000, refundAmount: 720_000,
    disputeCount: 7, disputeAmount: 63_000,
  },
  customers: { paying: 1284, netRevenue: 8_190_000, txns: 1284 },
  totals: { lifetimeInflow: 96_000_000, lifetimeOutflow: 59_000_000 },
  hasExpenses: true,
  source: "views",
};
