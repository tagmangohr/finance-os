-- ============================================================
-- FILE: 044_expense_status_filter.sql
-- Only POSTED (completed/refunded) debits count as expenses.
--
-- Bug: vw_metrics_monthly.expense_total and vw_metrics_totals.lifetime_outflow
-- summed bank expense debits WITHOUT a status filter, so failed/pending card
-- charges were counted as spend (≈₹20.5L of failed/pending leaked in). Revenue
-- already filtered status; expenses did not. Add the same
-- `status in ('completed','refunded')` guard to every expense sum (debit spend
-- AND credit reversal). vw_category_breakdown (042) and vw_bank_monthly (041)
-- already filter status, so they're untouched.
-- ============================================================

create or replace view vw_metrics_monthly as
select
  t.org_id,
  date_trunc('month', t.transaction_date)::date as month,
  coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'credit' and t.ledger = 'payments'
      and t.status in ('completed', 'refunded')), 0) as gross_revenue,
  coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'debit' and t.ledger = 'payments' and t.category = 'refund'), 0)
  + coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'credit' and t.ledger = 'payments' and t.status = 'refunded'), 0) as refunds,
  coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'debit' and t.status in ('completed', 'refunded') and (
        (t.ledger = 'bank' and t.pnl_treatment = 'expense')
        or (t.ledger = 'payments' and coalesce(t.category, '') not in ('refund', 'dispute', 'settlement'))
    )), 0)
  - coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'credit' and t.status in ('completed', 'refunded') and t.ledger = 'bank' and t.pnl_treatment = 'expense'), 0) as expense_total,
  count(*) filter (where t.type = 'credit' and t.ledger = 'payments' and t.status = 'completed') as txn_count,
  count(distinct lower(t.counterparty_name))
    filter (where t.type = 'credit' and t.ledger = 'payments' and t.status = 'completed'
      and coalesce(t.counterparty_name, '') <> '') as paying_customers
from transactions t
where t.transaction_date <= current_date
  and t.transaction_date >= (date_trunc('month', current_date) - interval '13 months')::date
  and coalesce(t.category, '') <> 'settlement'
  and coalesce(t.source, '') !~* '(settlement|payout)'
group by t.org_id, date_trunc('month', t.transaction_date);

create or replace view vw_metrics_totals as
select
  t.org_id,
  coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'credit' and t.ledger = 'payments' and t.status = 'completed'), 0) as lifetime_inflow,
  coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'debit' and t.status in ('completed', 'refunded') and (
        (t.ledger = 'bank' and t.pnl_treatment = 'expense')
        or (t.ledger = 'payments' and coalesce(t.category, '') not in ('dispute', 'settlement'))
    )), 0)
  - coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'credit' and t.status in ('completed', 'refunded') and t.ledger = 'bank' and t.pnl_treatment = 'expense'), 0) as lifetime_outflow
from transactions t
where t.transaction_date <= current_date
  and coalesce(t.category, '') <> 'settlement'
  and coalesce(t.source, '') !~* '(settlement|payout)'
group by t.org_id;

grant select on vw_metrics_monthly, vw_metrics_totals to authenticated, anon, service_role;
