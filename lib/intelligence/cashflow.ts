import type { SupabaseClient } from '@supabase/supabase-js';
import { POSTED_TRANSACTION_STATUSES } from '@/lib/finance/transaction-status';
import { selectAll } from '@/lib/supabase/paginate';
import type { CashFlowResult } from './types';

/** Simple OLS linear regression: returns { slope, intercept } */
function linearRegression(
  xs: number[],
  ys: number[]
): { slope: number; intercept: number } {
  const n = xs.length;
  if (n === 0) return { slope: 0, intercept: 0 };

  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sumX2 = xs.reduce((a, x) => a + x * x, 0);

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export async function calculateCashFlow(
  orgId: string,
  supabase: SupabaseClient
): Promise<CashFlowResult> {
  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(today.getDate() - 90);
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  // Fetch all transactions from last 90 days (paginated — a busy 90-day window
  // exceeds 1000 rows, and the old capped query truncated the daily series).
  // category is fetched so we can exclude settlement transfers from inflows.
  const txns = await selectAll<{ amount: number; type: 'credit' | 'debit'; category: string | null; transaction_date: string }>((from, to) =>
    supabase
      .from('transactions')
      .select('amount, type, category, transaction_date')
      .eq('org_id', orgId)
      .in('status', POSTED_TRANSACTION_STATUSES)
      .gte('transaction_date', fmt(ninetyDaysAgo))
      .lte('transaction_date', fmt(today))
      .order('transaction_date', { ascending: true })
      .range(from, to)
  );

  // Build day-by-day map.
  // Exclude settlements (category = 'settlement') from inflows — they are the
  // gateway's delayed bank transfer of already-collected payments, not new money.
  const dayMap = new Map<string, { inflow: number; outflow: number }>();

  for (const t of txns) {
    if (t.type === 'credit' && t.category === 'settlement') continue;
    const dateStr = t.transaction_date;
    const existing = dayMap.get(dateStr) ?? { inflow: 0, outflow: 0 };
    if (t.type === 'credit') {
      existing.inflow += Number(t.amount);
    } else {
      existing.outflow += Number(t.amount);
    }
    dayMap.set(dateStr, existing);
  }

  // Build sorted daily_data for last 90 days, computing running balance
  const dailyData: CashFlowResult['daily_data'] = [];
  let runningBalance = 0;

  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = fmt(d);
    const { inflow, outflow } = dayMap.get(dateStr) ?? { inflow: 0, outflow: 0 };
    runningBalance += inflow - outflow;
    dailyData.push({ date: dateStr, inflow, outflow, balance: runningBalance });
  }

  // Last 30 days aggregates
  const last30 = dailyData.slice(-30);
  const inflows30d = last30.reduce((sum, d) => sum + d.inflow, 0);
  const outflows30d = last30.reduce((sum, d) => sum + d.outflow, 0);
  const net30d = inflows30d - outflows30d;

  // Linear regression on daily net balance trend (last 30 days)
  const xs = last30.map((_, i) => i);
  const ys = last30.map((d) => d.balance);
  const { slope } = linearRegression(xs, ys);

  const lastBalance = dailyData[dailyData.length - 1]?.balance ?? 0;
  const forecast30d = lastBalance + slope * 30;
  const forecast60d = lastBalance + slope * 60;
  const forecast90d = lastBalance + slope * 90;

  return {
    inflows_30d: inflows30d,
    outflows_30d: outflows30d,
    net_30d: net30d,
    forecast_30d: forecast30d,
    forecast_60d: forecast60d,
    forecast_90d: forecast90d,
    daily_data: dailyData,
  };
}
