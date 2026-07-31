-- ============================================================
-- FILE: 041_expense_reversals_netoff.sql
-- Expense reversals / refunds net off against the expense.
--
-- A bank CREDIT in an expense-treatment category is a reversal/refund of a prior
-- spend — it must REDUCE expenses, not be counted as income. So the expense
-- rollups become direction-aware: treatment='expense' → debit adds, credit
-- subtracts; treatment='income' → credit adds, debit subtracts (symmetric
-- clawback). A vendor's payment + its later reversal, both tagged to that vendor's
-- category (via counterparty memory), net to zero automatically.
--
-- Only re-defines the views that sum expenses/income. Revenue firewall (038/039)
-- and the payments-ledger logic are unchanged.
-- ============================================================

-- Explicit bucket for a reversal you don't want pinned to a specific line.
-- treatment='expense' → a CREDIT here subtracts from expenses.
insert into ledger_categories (org_id, slug, label, treatment, flow, sort, is_system) values
  (null, 'expense_reversal', 'Expense Reversal / Refund', 'expense', 'in', 135, true)
on conflict do nothing;

-- ── Monthly rollup — netted expense_total ───────────────────────────────────
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
  -- Expenses: debit spend minus bank credit reversals (both treatment='expense').
  coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'debit' and (
        (t.ledger = 'bank' and t.pnl_treatment = 'expense')
        or (t.ledger = 'payments' and coalesce(t.category, '') not in ('refund', 'dispute', 'settlement'))
    )), 0)
  - coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'credit' and t.ledger = 'bank' and t.pnl_treatment = 'expense'), 0) as expense_total,
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

-- ── Lifetime totals — netted outflow ────────────────────────────────────────
create or replace view vw_metrics_totals as
select
  t.org_id,
  coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'credit' and t.ledger = 'payments' and t.status = 'completed'), 0) as lifetime_inflow,
  coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'debit' and (
        (t.ledger = 'bank' and t.pnl_treatment = 'expense')
        or (t.ledger = 'payments' and coalesce(t.category, '') not in ('dispute', 'settlement'))
    )), 0)
  - coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'credit' and t.ledger = 'bank' and t.pnl_treatment = 'expense'), 0) as lifetime_outflow
from transactions t
where t.transaction_date <= current_date
  and coalesce(t.category, '') <> 'settlement'
  and coalesce(t.source, '') !~* '(settlement|payout)'
group by t.org_id;

grant select on vw_metrics_monthly, vw_metrics_totals to authenticated, anon, service_role;

-- ── Expense Breakdown — netted per category ─────────────────────────────────
create or replace view vw_category_breakdown as
with expense_rows as (
  select
    t.org_id,
    t.category,
    -- Debit = +spend, credit = −reversal. So a category nets to its true spend.
    (case when t.type = 'debit' then 1 else -1 end) * coalesce(t.amount_base, t.amount) as amt
  from transactions t
  where t.status in ('completed', 'refunded')
    and (
      (t.ledger = 'bank' and t.pnl_treatment = 'expense')                                        -- both directions
      or (t.ledger = 'payments' and t.type = 'debit' and coalesce(t.category, '') not in ('refund', 'dispute', 'settlement'))
    )
),
agg as (
  select org_id, category, sum(amt) as total_amount, count(*) as transaction_count
  from expense_rows
  group by org_id, category
),
org_totals as (
  select org_id, sum(total_amount) as grand_total
  from agg
  group by org_id
)
select
  a.org_id,
  coalesce(lc.label, initcap(replace(a.category, '_', ' ')), 'Uncategorized') as category,
  a.total_amount,
  a.transaction_count,
  round(a.total_amount / nullif(ot.grand_total, 0) * 100, 2) as pct_of_total
from agg a
join org_totals ot on ot.org_id = a.org_id
left join lateral (
  select label from ledger_categories lc
  where lc.slug = a.category and (lc.org_id = a.org_id or lc.org_id is null)
  order by (lc.org_id is not null) desc
  limit 1
) lc on true
where a.total_amount <> 0
order by a.org_id, a.total_amount desc;

-- ── Bank monthly — netted expense + income ──────────────────────────────────
create or replace view vw_bank_monthly with (security_invoker = true) as
select
  t.org_id,
  date_trunc('month', t.transaction_date)::date as month,
  coalesce(sum(coalesce(t.amount_base, t.amount)) filter (where t.type = 'debit'  and t.pnl_treatment = 'expense'), 0)
  - coalesce(sum(coalesce(t.amount_base, t.amount)) filter (where t.type = 'credit' and t.pnl_treatment = 'expense'), 0) as expense_total,
  coalesce(sum(coalesce(t.amount_base, t.amount)) filter (where t.type = 'credit' and t.pnl_treatment = 'income'), 0)
  - coalesce(sum(coalesce(t.amount_base, t.amount)) filter (where t.type = 'debit'  and t.pnl_treatment = 'income'), 0) as income_total,
  coalesce(sum(coalesce(t.amount_base, t.amount)) filter (where t.type = 'debit'  and coalesce(t.pnl_treatment, '') = 'excluded'), 0) as excluded_out,
  coalesce(sum(coalesce(t.amount_base, t.amount)) filter (where t.type = 'credit' and coalesce(t.pnl_treatment, '') = 'excluded'), 0) as excluded_in,
  count(*) filter (where coalesce(t.pnl_treatment, 'uncategorized') = 'uncategorized') as uncategorized_count,
  count(*) as txn_count
from transactions t
where t.ledger = 'bank' and t.status in ('completed', 'refunded')
group by t.org_id, date_trunc('month', t.transaction_date);

grant select on vw_bank_monthly to authenticated, anon, service_role;
