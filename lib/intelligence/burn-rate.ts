import type { SupabaseClient } from '@supabase/supabase-js';
import type { BurnRateResult } from './types';

export async function calculateBurnRate(
  orgId: string,
  supabase: SupabaseClient
): Promise<BurnRateResult> {
  const today = new Date();

  // Current month bounds
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const currentMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  // Previous month bounds
  const prevMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

  const fmt = (d: Date) => d.toISOString().split('T')[0];

  // Fetch current and previous month debits in parallel
  const [currentResult, previousResult] = await Promise.all([
    supabase
      .from('transactions')
      .select('amount, category')
      .eq('org_id', orgId)
      .eq('type', 'debit')
      .eq('status', 'completed')
      .gte('transaction_date', fmt(currentMonthStart))
      .lte('transaction_date', fmt(currentMonthEnd)),
    supabase
      .from('transactions')
      .select('amount, category')
      .eq('org_id', orgId)
      .eq('type', 'debit')
      .eq('status', 'completed')
      .gte('transaction_date', fmt(prevMonthStart))
      .lte('transaction_date', fmt(prevMonthEnd)),
  ]);

  const currentTxns = currentResult.data ?? [];
  const previousTxns = previousResult.data ?? [];

  const currentMonth = currentTxns.reduce((sum, t) => sum + Number(t.amount), 0);
  const previousMonth = previousTxns.reduce((sum, t) => sum + Number(t.amount), 0);

  // Change percentage
  const changePct =
    previousMonth > 0
      ? ((currentMonth - previousMonth) / previousMonth) * 100
      : 0;

  // Group current month by category
  const categoryMap = new Map<string, number>();
  for (const t of currentTxns) {
    const cat = t.category ?? 'Uncategorized';
    categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + Number(t.amount));
  }

  const topCategories = Array.from(categoryMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, amount]) => ({
      category,
      amount,
      pct: currentMonth > 0 ? (amount / currentMonth) * 100 : 0,
    }));

  // Trend determination
  let trend: BurnRateResult['trend'];
  if (changePct > 10) {
    trend = 'increasing';
  } else if (changePct < -10) {
    trend = 'decreasing';
  } else {
    trend = 'stable';
  }

  return {
    current_month: currentMonth,
    previous_month: previousMonth,
    change_pct: changePct,
    top_categories: topCategories,
    trend,
  };
}
