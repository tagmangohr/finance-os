-- ============================================================
-- FILE: 050_cashflow_runway_views.sql
-- Kill the last raw-transaction drains behind the Cashflow + Bank pages by
-- pushing their 90-day aggregation into Postgres:
--   • vw_cashflow_daily  — per-day inflow/outflow (replaces getCashFlowDetails'
--     ~17k-row selectAll; the page reads ≤90 daily rows and groups months in JS).
--   • vw_runway_inputs   — the three 90-day sums calculateRunway needs (burn
--     debits, PG credits, expense reversals), replacing its 2–3 selectAll scans.
--
-- Both replicate the app's exact classification:
--   - transfer sources (…_payout / …_settlement) excluded (already-recorded money)
--   - bank ledger: only pnl_treatment in (income,expense) is real cash flow;
--     credit = inflow, debit = outflow
--   - payments ledger: credit (non-settlement) = inflow, debit = outflow
--   - burn = debits that are bank-expense OR payments-non-transfer
-- ============================================================

-- ── Daily cash flow (last 90 days) ──────────────────────────────────────────
create or replace view vw_cashflow_daily as
select
  t.org_id,
  t.transaction_date as date,
  coalesce(sum(coalesce(t.amount_base, t.amount)) filter (where
    (t.ledger = 'bank' and t.pnl_treatment in ('income','expense') and t.type = 'credit')
    or (t.ledger = 'payments' and t.type = 'credit' and coalesce(t.category,'') <> 'settlement')
  ), 0) as inflow,
  coalesce(sum(coalesce(t.amount_base, t.amount)) filter (where
    (t.ledger = 'bank' and t.pnl_treatment in ('income','expense') and t.type = 'debit')
    or (t.ledger = 'payments' and t.type = 'debit')
  ), 0) as outflow
from transactions t
where t.status in ('completed','refunded')
  and t.transaction_date >= (current_date - interval '90 days')
  and t.transaction_date <= current_date
  and coalesce(t.source,'') !~ '_(payout|settlement)$'   -- isTransferSource() equivalent
group by t.org_id, t.transaction_date;

-- ── Runway inputs (last 90 days), one row per org ───────────────────────────
create or replace view vw_runway_inputs as
select
  t.org_id,
  -- operating-expense debits = burn (bank expense OR payments non-transfer debit)
  coalesce(sum(coalesce(t.amount_base, t.amount)) filter (where t.type = 'debit' and (
    (t.ledger = 'bank' and t.pnl_treatment = 'expense')
    or (t.ledger = 'payments' and coalesce(t.source,'') !~ '_(payout|settlement)$')
  )), 0) as burn_debits_90d,
  -- PG collections (non-settlement credits) for the fallback cash-balance proxy
  coalesce(sum(coalesce(t.amount_base, t.amount)) filter (where
    t.type = 'credit' and t.ledger = 'payments' and coalesce(t.category,'') <> 'settlement'
  ), 0) as credits_90d,
  -- bank expense reversals (credits in an expense category) — net out of burn
  coalesce(sum(coalesce(t.amount_base, t.amount)) filter (where
    t.type = 'credit' and t.ledger = 'bank' and t.pnl_treatment = 'expense'
  ), 0) as reversals_90d
from transactions t
where t.status in ('completed','refunded')
  and t.transaction_date >= (current_date - interval '90 days')
  and t.transaction_date <= current_date
group by t.org_id;

grant select on vw_cashflow_daily, vw_runway_inputs to authenticated, anon, service_role;
