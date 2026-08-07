import type { SupabaseClient } from '@supabase/supabase-js';
import { POSTED_TRANSACTION_STATUSES, isTransferSource } from '@/lib/finance/transaction-status';
import { baseAmt } from '@/lib/utils';
import { selectAll } from '@/lib/supabase/paginate';
import { getMercuryCashPosition } from '@/lib/expenses/mercury-balances';
import type { RunwayResult } from './types';

export async function calculateRunway(
  orgId: string,
  supabase: SupabaseClient
): Promise<RunwayResult> {
  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(today.getDate() - 90);
  const todayStr = today.toISOString().split('T')[0];
  const ninetyStr = ninetyDaysAgo.toISOString().split('T')[0];

  // The three 90-day sums (burn debits, PG credits, expense reversals) come from
  // vw_runway_inputs — one row, computed in Postgres — instead of draining tens
  // of thousands of raw rows into JS. Fetched with the snapshot in parallel.
  const [snapshotResult, inputsRes] = await Promise.all([
    supabase
      .from('financial_snapshots')
      .select('cash_balance')
      .eq('org_id', orgId)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('vw_runway_inputs' as never)
      .select('burn_debits_90d, credits_90d, reversals_90d')
      .eq('org_id' as never, orgId)
      .maybeSingle(),
  ]);

  let totalDebits90d: number;
  let totalCredits90d: number;
  let totalReversals90d: number;

  const inputs = inputsRes.data as unknown as { burn_debits_90d: number; credits_90d: number; reversals_90d: number } | null;
  if (inputs) {
    totalDebits90d = Number(inputs.burn_debits_90d ?? 0);
    totalCredits90d = Number(inputs.credits_90d ?? 0);
    totalReversals90d = Number(inputs.reversals_90d ?? 0);
  } else {
    // Fallback (view not applied yet): drain the 90-day rows. A debit is burn only
    // if it's an operating expense — bank debits categorized 'expense', or PG-ledger
    // debits that aren't transfers/payouts.
    const countsAsBurn = (t: { ledger: 'payments' | 'bank'; pnl_treatment: string | null; source: string | null }) =>
      t.ledger === 'bank' ? t.pnl_treatment === 'expense' : !isTransferSource(t.source ?? undefined);
    const [debits90, credits90, reversals90] = await Promise.all([
      selectAll<{ amount: number; amount_base: number | null; source: string | null; ledger: 'payments' | 'bank'; pnl_treatment: string | null }>((from, to) =>
        supabase.from('transactions').select('amount, amount_base, source, ledger, pnl_treatment')
          .eq('org_id', orgId).eq('type', 'debit').in('status', POSTED_TRANSACTION_STATUSES)
          .gte('transaction_date', ninetyStr).lte('transaction_date', todayStr).range(from, to)),
      selectAll<{ amount: number; amount_base: number | null }>((from, to) =>
        supabase.from('transactions').select('amount, amount_base')
          .eq('org_id', orgId).eq('type', 'credit').eq('ledger', 'payments')
          .or('category.is.null,category.neq.settlement').in('status', POSTED_TRANSACTION_STATUSES)
          .gte('transaction_date', ninetyStr).lte('transaction_date', todayStr).range(from, to)),
      selectAll<{ amount: number; amount_base: number | null }>((from, to) =>
        supabase.from('transactions').select('amount, amount_base')
          .eq('org_id', orgId).eq('type', 'credit').eq('ledger', 'bank').eq('pnl_treatment', 'expense')
          .in('status', POSTED_TRANSACTION_STATUSES)
          .gte('transaction_date', ninetyStr).lte('transaction_date', todayStr).range(from, to)),
    ]);
    totalDebits90d = debits90.filter(countsAsBurn).reduce((s, t) => s + baseAmt(t), 0);
    totalCredits90d = credits90.reduce((s, t) => s + baseAmt(t), 0);
    totalReversals90d = reversals90.reduce((s, t) => s + baseAmt(t), 0);
  }

  // Cash balance: prefer the stored snapshot; else a 90-day net proxy (credits −
  // burn debits over the same window — avoids all-time payout/settlement inflation).
  let cashBalance = snapshotResult.data?.cash_balance != null
    ? Number(snapshotResult.data.cash_balance)
    : Math.max(0, totalCredits90d - totalDebits90d);

  // Prefer the TRUE cash position from stored Mercury balances when available
  // (checking + savings + treasury − card owed). Service-client only (RLS); on the
  // user-client path this returns no data and we keep the transaction-derived proxy.
  try {
    const merc = await getMercuryCashPosition(orgId, supabase);
    if (merc.hasData) cashBalance = Math.max(0, merc.cashBase);
  } catch { /* keep proxy */ }

  // Average monthly burn = (operating-expense debits − expense reversals) / 3 months.
  const avgMonthlyBurn = Math.max(0, totalDebits90d - totalReversals90d) / 3;

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
