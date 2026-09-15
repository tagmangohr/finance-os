-- 123_dash_bank_revenue.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY: "Revenue" read differently across tabs. The Dashboard and Revenue tab
-- counted GATEWAY payments only (_dm_gross: credit · ledger='payments' ·
-- status in (completed,refunded)) → ₹15.40Cr, while the P&L (and Analytics, which
-- reuses getPnl) count COMPREHENSIVE revenue = gateway payments PLUS customer
-- payments collected directly into the bank (ledger='bank', pnl_treatment='income',
-- category='customer_payment'), honouring the per-connector include-income toggle
-- → ₹16.48Cr. The ~₹1.08Cr gap is exactly that bank-collected revenue.
--
-- FIX: expose the bank-collected customer-payment revenue (the missing piece) for an
-- arbitrary window — total and month-wise — using the SAME predicate lib/pnl.ts uses
-- (REVENUE_INCOME_CATS = {'customer_payment'}, conn_include_income=true, signed
-- credit +/debit −, status in (completed,refunded)). The app adds this on top of the
-- payments rollup so the Revenue number matches the P&L on every tab, while the
-- payment-health metrics (success rate, refund rate, AOV, Gross Volume) keep using
-- gateway-only volume — which is correct for those.
--
-- The payments rollups (068) are deliberately NOT touched, so no rollup rebuild is
-- needed. The bank-income slice is tiny and indexed, so these read transactions live.
-- ─────────────────────────────────────────────────────────────────────────────

-- Lean partial index so the bank-income slice scans tight at any table size.
create index if not exists idx_txn_bank_income
  on transactions (org_id, transaction_date)
  where ledger = 'bank' and pnl_treatment = 'income';

-- Signed base: income credit adds, debit (clawback/reversal) subtracts — matches
-- lib/pnl.ts (signed = credit ? +amt : -amt). Only category='customer_payment'
-- (operating revenue; other income categories are non-operating "Other Income" and
-- are NOT revenue), include-income ON, posted statuses.
create or replace function dash_bank_revenue_range(p_org uuid, p_from date, p_to date)
returns numeric language sql stable as $$
  select coalesce(sum(
    case when type = 'credit' then coalesce(amount_base, amount, 0)
         else -coalesce(amount_base, amount, 0) end), 0)
  from transactions
  where org_id = p_org
    and ledger = 'bank'
    and pnl_treatment = 'income'
    and category = 'customer_payment'
    and conn_include_income = true
    and status in ('completed', 'refunded')
    and transaction_date >= p_from
    and transaction_date <= p_to;
$$;

create or replace function dash_bank_revenue_monthly(p_org uuid, p_from date, p_to date)
returns table(month date, amount numeric) language sql stable as $$
  select date_trunc('month', transaction_date)::date as month,
    coalesce(sum(
      case when type = 'credit' then coalesce(amount_base, amount, 0)
           else -coalesce(amount_base, amount, 0) end), 0) as amount
  from transactions
  where org_id = p_org
    and ledger = 'bank'
    and pnl_treatment = 'income'
    and category = 'customer_payment'
    and conn_include_income = true
    and status in ('completed', 'refunded')
    and transaction_date >= p_from
    and transaction_date <= p_to
  group by 1
  order by 1;
$$;

grant execute on function dash_bank_revenue_range(uuid, date, date),
                          dash_bank_revenue_monthly(uuid, date, date)
  to authenticated, anon, service_role;
