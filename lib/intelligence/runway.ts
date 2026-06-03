import type { SupabaseClient } from '@supabase/supabase-js';
import { POSTED_TRANSACTION_STATUSES } from '@/lib/finance/transaction-status';
import type { RunwayResult } from './types';

export async function calculateRunway(
  orgId: string,
  supabase: SupabaseClient
): Promise<RunwayResult> {
  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(today.getDate() - 90);

  // Run balance snapshot fetch and debit transactions in parallel
  const [snapshotResult, debitsResult] = await Promise.all([
    supabase
      .from('financial_snapshots')
      .select('cash_balance')
      .eq('org_id', orgId)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('transactions')
      .select('amount, transaction_date')
      .eq('org_id', orgId)
      .eq('type', 'debit')
      .in('status', POSTED_TRANSACTION_STATUSES)
      .gte('transaction_date', ninetyDaysAgo.toISOString().split('T')[0]),
  ]);

  // Compute cash balance: prefer snapshot, fall back to credits - debits
  let cashBalance = 0;

  if (snapshotResult.data?.cash_balance != null) {
    cashBalance = Number(snapshotResult.data.cash_balance);
  } else {
    // Fall back: compute from all-time transactions
    const [allCredits, allDebits] = await Promise.all([
      supabase
        .from('transactions')
        .select('amount')
        .eq('org_id', orgId)
        .eq('type', 'credit')
        .in('status', POSTED_TRANSACTION_STATUSES),
      supabase
        .from('transactions')
        .select('amount')
        .eq('org_id', orgId)
        .eq('type', 'debit')
        .in('status', POSTED_TRANSACTION_STATUSES),
    ]);

    const totalCredits = (allCredits.data ?? []).reduce(
      (sum, t) => sum + Number(t.amount),
      0
    );
    const totalDebits = (allDebits.data ?? []).reduce(
      (sum, t) => sum + Number(t.amount),
      0
    );
    cashBalance = Math.max(0, totalCredits - totalDebits);
  }

  // Compute average monthly burn from last 90 days of debits
  const debits = debitsResult.data ?? [];
  const totalDebits90d = debits.reduce((sum, t) => sum + Number(t.amount), 0);
  // 90 days ≈ 3 months
  const avgMonthlyBurn = totalDebits90d / 3;

  const burnRate = avgMonthlyBurn;
  const runwayDays =
    burnRate > 0 ? Math.floor((cashBalance / burnRate) * 30) : 9999;

  // Projected zero date
  const projectedZeroDate = new Date(today);
  projectedZeroDate.setDate(today.getDate() + runwayDays);

  // Severity thresholds
  let severity: RunwayResult['severity'];
  let runwayLabel: string;

  if (runwayDays <= 60) {
    severity = 'critical';
    runwayLabel = `${runwayDays} days`;
  } else if (runwayDays <= 120) {
    severity = 'warning';
    runwayLabel = `${Math.round(runwayDays / 30)} months`;
  } else if (runwayDays >= 9999) {
    severity = 'good';
    runwayLabel = 'No burn / infinite';
  } else {
    severity = 'good';
    const months = Math.round(runwayDays / 30);
    runwayLabel = months >= 12 ? `${Math.round(months / 12)} years` : `${months} months`;
  }

  return {
    cash_balance: cashBalance,
    burn_rate: burnRate,
    runway_days: runwayDays,
    runway_label: runwayLabel,
    severity,
    projected_zero_date: projectedZeroDate.toISOString().split('T')[0],
  };
}
