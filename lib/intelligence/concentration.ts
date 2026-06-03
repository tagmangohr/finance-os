import type { SupabaseClient } from '@supabase/supabase-js';
import { POSTED_TRANSACTION_STATUSES } from '@/lib/finance/transaction-status';
import type { ConcentrationResult } from './types';

export async function calculateConcentration(
  orgId: string,
  supabase: SupabaseClient
): Promise<ConcentrationResult> {
  const today = new Date();
  const twelveMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 11, 1);
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  // Get all credit transactions with counterparty info for last 12 months
  const { data: transactions } = await supabase
    .from('transactions')
    .select('amount, counterparty_id, counterparty_name')
    .eq('org_id', orgId)
    .eq('type', 'credit')
    .in('status', POSTED_TRANSACTION_STATUSES)
    .gte('transaction_date', fmt(twelveMonthsAgo))
    .not('counterparty_id', 'is', null);

  const txns = transactions ?? [];

  // Aggregate revenue per entity
  const entityMap = new Map<string, { name: string; revenue: number }>();

  for (const t of txns) {
    if (!t.counterparty_id) continue;
    const existing = entityMap.get(t.counterparty_id);
    if (existing) {
      existing.revenue += Number(t.amount);
    } else {
      entityMap.set(t.counterparty_id, {
        name: t.counterparty_name ?? 'Unknown',
        revenue: Number(t.amount),
      });
    }
  }

  const totalRevenue = Array.from(entityMap.values()).reduce(
    (sum, e) => sum + e.revenue,
    0
  );

  // Sort by revenue descending and compute pct
  const topCustomers = Array.from(entityMap.entries())
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 10)
    .map(([entity_id, data]) => ({
      entity_id,
      name: data.name,
      revenue: data.revenue,
      pct: totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0,
    }));

  // Herfindahl-Hirschman Index = sum of (share)^2 where share = revenue/total
  // Use all entities, not just top 10
  const hhi =
    totalRevenue > 0
      ? Array.from(entityMap.values()).reduce((sum, e) => {
          const share = e.revenue / totalRevenue;
          return sum + share * share;
        }, 0)
      : 0;

  // Risk level thresholds
  let riskLevel: ConcentrationResult['risk_level'];
  if (hhi > 0.25) {
    riskLevel = 'critical';
  } else if (hhi > 0.15) {
    riskLevel = 'high';
  } else if (hhi > 0.1) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }

  return {
    top_customers: topCustomers,
    herfindahl_index: hhi,
    risk_level: riskLevel,
  };
}
