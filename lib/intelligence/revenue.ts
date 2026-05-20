import type { SupabaseClient } from '@supabase/supabase-js';
import type { RevenueResult } from './types';

export async function calculateRevenue(
  orgId: string,
  supabase: SupabaseClient
): Promise<RevenueResult> {
  const today = new Date();

  // Start from 13 months ago (to cover YoY comparison)
  const startDate = new Date(today.getFullYear(), today.getMonth() - 12, 1);
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  const { data: transactions } = await supabase
    .from('transactions')
    .select('amount, transaction_date')
    .eq('org_id', orgId)
    .eq('type', 'credit')
    .eq('status', 'completed')
    .gte('transaction_date', fmt(startDate))
    .order('transaction_date', { ascending: true });

  const txns = transactions ?? [];

  // Group by YYYY-MM
  const monthMap = new Map<string, number>();
  for (const t of txns) {
    const d = new Date(t.transaction_date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthMap.set(key, (monthMap.get(key) ?? 0) + Number(t.amount));
  }

  // Build sorted month array (last 13 months)
  const byMonth: { month: string; amount: number }[] = [];
  for (let i = 12; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    byMonth.push({ month: key, amount: monthMap.get(key) ?? 0 });
  }

  // Current month is the last entry; MRR = average of last 3 months
  const last3 = byMonth.slice(-3);
  const mrr = last3.reduce((sum, m) => sum + m.amount, 0) / 3;
  const arr = mrr * 12;

  // MoM growth: current vs previous month
  const thisMonth = byMonth[byMonth.length - 1]?.amount ?? 0;
  const lastMonth = byMonth[byMonth.length - 2]?.amount ?? 0;
  const momGrowth =
    lastMonth > 0 ? ((thisMonth - lastMonth) / lastMonth) * 100 : 0;

  // YoY growth: this month vs same month last year (index 0)
  const sameMonthLastYear = byMonth[0]?.amount ?? 0;
  const yoyGrowth =
    sameMonthLastYear > 0
      ? ((thisMonth - sameMonthLastYear) / sameMonthLastYear) * 100
      : 0;

  // YTD: Jan 1 of current year to today
  const janFirst = `${today.getFullYear()}-01`;
  const totalYtd = byMonth
    .filter((m) => m.month >= janFirst)
    .reduce((sum, m) => sum + m.amount, 0);

  return {
    mrr,
    arr,
    mom_growth: momGrowth,
    yoy_growth: yoyGrowth,
    total_ytd: totalYtd,
    by_month: byMonth,
  };
}
