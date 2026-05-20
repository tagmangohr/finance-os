import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnomalyResult } from './types';

export async function detectAnomalies(
  orgId: string,
  supabase: SupabaseClient
): Promise<AnomalyResult> {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);

  // Fetch last 30 days + historical baseline (90 days) in parallel
  const [recentResult, historicalResult] = await Promise.all([
    supabase
      .from('transactions')
      .select('id, amount, category, counterparty_id, description, transaction_date')
      .eq('org_id', orgId)
      .eq('status', 'completed')
      .gte('transaction_date', thirtyDaysAgo.toISOString().split('T')[0])
      .order('transaction_date', { ascending: false }),
    supabase
      .from('transactions')
      .select('amount, category, counterparty_id')
      .eq('org_id', orgId)
      .eq('status', 'completed')
      .gte(
        'transaction_date',
        new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0]
      ),
  ]);

  const recentTxns = recentResult.data ?? [];
  const historicalTxns = historicalResult.data ?? [];

  // Build category stats from historical data
  const categoryStats = new Map<
    string,
    { amounts: number[]; mean: number; std: number }
  >();

  for (const t of historicalTxns) {
    const cat = t.category ?? 'Uncategorized';
    const existing = categoryStats.get(cat);
    if (existing) {
      existing.amounts.push(Number(t.amount));
    } else {
      categoryStats.set(cat, { amounts: [Number(t.amount)], mean: 0, std: 0 });
    }
  }

  // Compute mean and std for each category
  for (const [, stats] of categoryStats) {
    const n = stats.amounts.length;
    stats.mean = stats.amounts.reduce((a, b) => a + b, 0) / n;
    const variance =
      stats.amounts.reduce((a, b) => a + (b - stats.mean) ** 2, 0) / n;
    stats.std = Math.sqrt(variance);
  }

  // Overall average transaction amount for "new counterparty" threshold
  const allAmounts = historicalTxns.map((t) => Number(t.amount));
  const overallAvg =
    allAmounts.length > 0
      ? allAmounts.reduce((a, b) => a + b, 0) / allAmounts.length
      : 0;

  // Track known counterparties from historical (before recent window)
  const historicalCounterparties = new Set(
    historicalTxns
      .filter((t) => t.counterparty_id)
      .map((t) => t.counterparty_id)
  );

  const anomalies: AnomalyResult['anomalies'] = [];

  for (const t of recentTxns) {
    const amount = Number(t.amount);
    const cat = t.category ?? 'Uncategorized';
    const stats = categoryStats.get(cat);

    // Check statistical deviation (>2 std from mean)
    if (stats && stats.std > 0) {
      const zScore = Math.abs((amount - stats.mean) / stats.std);
      if (zScore > 2) {
        let severity: 'high' | 'medium' | 'low';
        if (zScore > 4) severity = 'high';
        else if (zScore > 3) severity = 'medium';
        else severity = 'low';

        const direction = amount > stats.mean ? 'above' : 'below';
        anomalies.push({
          transaction_id: t.id,
          amount,
          description: t.description ?? `${cat} transaction`,
          reason: `Amount is ${zScore.toFixed(1)}x std deviations ${direction} average for category "${cat}" (avg: ₹${Math.round(stats.mean).toLocaleString()})`,
          severity,
          date: t.transaction_date,
        });
        continue; // Don't double-flag
      }
    }

    // Check new counterparty with large amount (> avg * 3)
    if (
      t.counterparty_id &&
      !historicalCounterparties.has(t.counterparty_id) &&
      overallAvg > 0 &&
      amount > overallAvg * 3
    ) {
      const multiple = (amount / overallAvg).toFixed(1);
      anomalies.push({
        transaction_id: t.id,
        amount,
        description: t.description ?? 'Transaction with new counterparty',
        reason: `New counterparty with amount ₹${Math.round(amount).toLocaleString()} — ${multiple}x the average transaction (avg: ₹${Math.round(overallAvg).toLocaleString()})`,
        severity: amount > overallAvg * 10 ? 'high' : 'medium',
        date: t.transaction_date,
      });
    }
  }

  // Sort anomalies: high first, then by amount desc
  const severityOrder = { high: 0, medium: 1, low: 2 };
  anomalies.sort((a, b) => {
    const sev = severityOrder[a.severity] - severityOrder[b.severity];
    return sev !== 0 ? sev : b.amount - a.amount;
  });

  return { anomalies: anomalies.slice(0, 20) };
}
