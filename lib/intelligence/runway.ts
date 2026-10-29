import type { SupabaseClient } from '@supabase/supabase-js';
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

  // The 90-day burn/inflow come from the trigger-maintained cashflow ROLLUP
  // (cashflow_daily_range → rollup_cashflow_daily, ~90 daily rows). The old
  // vw_runway_inputs view (and its drain fallback) scanned the raw 90-day transaction
  // slice (~200k rows) and statement-timed-out as the ledger grew — a hard crash on the
  // un-try/caught Bank page-load path. The rollup's `outflow` mirrors the view's
  // operating-expense debits (_cf_out); its `inflow` mirrors the PG + bank-income credits
  // (_cf_in), which folds in the tiny expense-reversal credits — so we read reversals as 0
  // (negligible; at worst a slightly conservative burn). Fetched with the snapshot.
  const [snapshotResult, cashflowRes] = await Promise.all([
    supabase
      .from('financial_snapshots')
      .select('cash_balance')
      .eq('org_id', orgId)
      .order('snapshot_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.rpc('cashflow_daily_range', { p_org: orgId, p_from: ninetyStr, p_to: todayStr }),
  ]);

  let totalDebits90d = 0;
  let totalCredits90d = 0;
  const totalReversals90d = 0; // folded into the rollup's inflow (negligible)
  if (!cashflowRes.error && Array.isArray(cashflowRes.data)) {
    for (const d of cashflowRes.data as Array<{ inflow: number | null; outflow: number | null }>) {
      totalCredits90d += Number(d.inflow ?? 0);
      totalDebits90d += Number(d.outflow ?? 0);
    }
  } else if (cashflowRes.error) {
    // Safe degradation: never crash the page on a runway read. Leaving the sums at 0
    // makes runway read "no burn" (cash still comes from the snapshot / Mercury balance).
    console.error('[runway] cashflow rollup read failed:', cashflowRes.error.message);
  }

  // Cash balance: prefer a POSITIVE stored snapshot, else a 90-day net proxy (credits −
  // burn debits over the same window — avoids all-time payout/settlement inflation). A
  // zero/absent snapshot must NOT read as "no cash" when the ledger shows a real position.
  const snapCash = Number(snapshotResult.data?.cash_balance ?? 0);
  let cashBalance = snapCash > 0 ? snapCash : Math.max(0, totalCredits90d - totalDebits90d);

  // Prefer the TRUE cash position from stored Mercury balances — but ONLY when it reports
  // a POSITIVE balance. An all-zero balance set (the balance sync hasn't populated real
  // figures) must not zero out cash. Service-client only (RLS); on the user-client path
  // this returns no data and we keep the transaction-derived proxy.
  try {
    const merc = await getMercuryCashPosition(orgId, supabase);
    if (merc.hasData && merc.cashBase > 0) cashBalance = merc.cashBase;
  } catch { /* keep proxy */ }

  // Monthly burn = gross operating spend (operating-expense debits − expense reversals) / 3.
  const grossMonthlyBurn = Math.max(0, totalDebits90d - totalReversals90d) / 3;

  const burnRate = grossMonthlyBurn;
  // Runway = days of cash left at the current SPEND rate — i.e. how long cash lasts if
  // income stopped. This is the conservative "survival runway" and is always a concrete
  // number (finite whenever there is any spend). We deliberately do NOT divide by NET
  // burn (spend − income): for a profitable company net burn is ≤ 0, which yields an
  // infinite/undefined runway, and the requirement is an exact days figure.
  const runwayDays =
    grossMonthlyBurn > 0 ? Math.floor((cashBalance / grossMonthlyBurn) * 30) : 9999;

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
