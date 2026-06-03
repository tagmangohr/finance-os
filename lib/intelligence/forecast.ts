import type { SupabaseClient } from "@supabase/supabase-js";
import { POSTED_TRANSACTION_STATUSES } from "@/lib/finance/transaction-status";
import type { ForecastResult } from "./types";

// Simple linear regression: returns slope and intercept
function linearRegression(values: number[]): { slope: number; intercept: number; r2: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0, r2: 0 };

  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;

  let ssXY = 0;
  let ssXX = 0;
  let ssYY = 0;

  for (let i = 0; i < n; i++) {
    ssXY += (i - xMean) * (values[i] - yMean);
    ssXX += (i - xMean) ** 2;
    ssYY += (values[i] - yMean) ** 2;
  }

  const slope = ssXX !== 0 ? ssXY / ssXX : 0;
  const intercept = yMean - slope * xMean;
  const r2 = ssYY !== 0 ? (ssXY ** 2) / (ssXX * ssYY) : 0;

  return { slope, intercept, r2 };
}

export async function generateForecast(
  orgId: string,
  supabase: SupabaseClient
): Promise<ForecastResult> {
  // Get last 6 months of monthly revenue
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const { data: txns } = await supabase
    .from("transactions")
    .select("amount, transaction_date")
    .eq("org_id", orgId)
    .eq("type", "credit")
    .in("status", POSTED_TRANSACTION_STATUSES)
    .gte("transaction_date", sixMonthsAgo.toISOString().split("T")[0]);

  if (!txns?.length) {
    return {
      revenue_next_month: 0,
      revenue_next_quarter: 0,
      confidence: 0,
      growth_rate: 0,
      assumptions: ["No historical data available to generate forecast."],
    };
  }

  // Group by month
  const byMonth: Record<string, number> = {};
  for (const t of txns) {
    const month = t.transaction_date.slice(0, 7); // YYYY-MM
    byMonth[month] = (byMonth[month] ?? 0) + t.amount;
  }

  const months = Object.keys(byMonth).sort();
  const values = months.map((m) => byMonth[m]);

  const { slope, intercept, r2 } = linearRegression(values);

  // Predict next 3 months
  const nextMonthIdx = values.length;
  const nextMonth = Math.max(0, slope * nextMonthIdx + intercept);
  const nextQ = Math.max(
    0,
    (slope * (nextMonthIdx) + intercept) +
    (slope * (nextMonthIdx + 1) + intercept) +
    (slope * (nextMonthIdx + 2) + intercept)
  );

  const lastValue = values[values.length - 1] ?? 0;
  const growthRate = lastValue > 0 ? (slope / lastValue) * 100 : 0;

  const confidence = Math.min(1, Math.max(0, r2));

  const assumptions = [
    `Based on last ${months.length} months of revenue data`,
    "Assumes current growth trajectory continues",
    "Excludes pending and failed transactions while including completed refunds",
    confidence < 0.5
      ? "Low confidence — revenue is volatile, add more data sources for accuracy"
      : "Moderate-to-high confidence based on trend consistency",
  ];

  return {
    revenue_next_month: Math.round(nextMonth),
    revenue_next_quarter: Math.round(nextQ),
    confidence: parseFloat(confidence.toFixed(2)),
    growth_rate: parseFloat(growthRate.toFixed(2)),
    assumptions,
  };
}
