import type { SupabaseClient } from '@supabase/supabase-js';
import { POSTED_TRANSACTION_STATUSES, isTransferSource } from '@/lib/finance/transaction-status';
import { baseAmt } from '@/lib/utils';
import { selectAll } from '@/lib/supabase/paginate';
import type { RunwayResult } from './types';

export async function calculateRunway(
  orgId: string,
  supabase: SupabaseClient
): Promise<RunwayResult> {
  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(today.getDate() - 90);
  const todayStr = today.toISOString().split('T')[0];

  // Run balance snapshot fetch and debit transactions in parallel (debits paginated).
  const [snapshotResult, debits90] = await Promise.all([
    supabase
      .from('financial_snapshots')
      .select('cash_balance')
      .eq('org_id', orgId)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    selectAll<{ amount: number; amount_base: number | null; transaction_date: string; source: string | null }>((from, to) =>
      supabase
        .from('transactions')
        .select('amount, amount_base, transaction_date, source')
        .eq('org_id', orgId)
        .eq('type', 'debit')
        .in('status', POSTED_TRANSACTION_STATUSES)
        .gte('transaction_date', ninetyDaysAgo.toISOString().split('T')[0])
        .lte('transaction_date', todayStr)
        .range(from, to)
    ),
  ]);

  // Compute cash balance: prefer snapshot, fall back to credits - debits
  let cashBalance = 0;

  if (snapshotResult.data?.cash_balance != null) {
    cashBalance = Number(snapshotResult.data.cash_balance);
  } else {
    // Fall back: 90-day net cash position (credits − debits over the same
    // window used for the burn-rate query).
    //
    // Using the same 90-day window for both sides avoids the all-time
    // historical-debit inflation that collapsed the old formula to ≈ 0
    // (all-time payout debits ≈ all-time settlement credits when Razorpay
    // sweeps nearly every rupee collected into the bank account).
    //
    // debits90 is already scoped to 90 days (fetched above).
    // Settlements are excluded from credits — they double-count payments.
    const credits90 = await selectAll<{ amount: number; amount_base: number | null }>((from, to) =>
      supabase
        .from('transactions')
        .select('amount, amount_base')
        .eq('org_id', orgId)
        .eq('type', 'credit')
        .not('category', 'eq', 'settlement')
        .in('status', POSTED_TRANSACTION_STATUSES)
        .gte('transaction_date', ninetyDaysAgo.toISOString().split('T')[0])
        .lte('transaction_date', todayStr)
        .range(from, to)
    );

    const totalCredits = credits90.reduce((sum, t) => sum + baseAmt(t), 0);
    const totalDebits = debits90
      .filter((t) => !isTransferSource(t.source ?? undefined))
      .reduce((sum, t) => sum + baseAmt(t), 0);
    cashBalance = Math.max(0, totalCredits - totalDebits);
  }

  // Compute average monthly burn from last 90 days of debits — excluding bank
  // transfers (payouts/settlements move charge money to the bank, not spend).
  const debits = debits90.filter(
    (t) => !isTransferSource(t.source ?? undefined)
  );
  const totalDebits90d = debits.reduce((sum, t) => sum + baseAmt(t), 0);
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
