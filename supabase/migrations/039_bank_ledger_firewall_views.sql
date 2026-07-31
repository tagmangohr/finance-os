-- ============================================================
-- FILE: 039_bank_ledger_firewall_views.sql
-- The double-count firewall + treatment-aware expenses, in the rollup views.
--
-- Rewrites the revenue/expense rollups so that:
--   • REVENUE / inflow / customer / payment-health metrics count ONLY the
--     payments ledger (PG money). Bank inflows NEVER inflate revenue — a PG
--     payout settling into the bank is money already counted once.
--   • EXPENSE / outflow counts real operating expenses: bank debits categorized
--     treatment='expense', plus the (historically ~empty) payments-ledger debits
--     that aren't refunds/disputes/settlements. Bank debits that are transfers /
--     owner draws / financing (treatment='excluded') and uncategorized bank rows
--     count as NOTHING until classified.
--
-- Also adds bank-only rollups (vw_bank_monthly, vw_bank_category) for the Bank
-- dashboard, as security_invoker views so bank detail stays owner/service-only
-- (the aggregate expense total still surfaces via vw_category_breakdown, which is
-- intentionally shared).
--
-- Mirrors migrations 020 (multicurrency) + 028 (metric rollups) exactly, with the
-- ledger/treatment predicates layered in. No new base-table scans of note.
-- ============================================================

-- ── Monthly revenue rollup (last 13 months) ──────────────────────────────────
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
    filter (where t.type = 'debit' and (
        (t.ledger = 'bank' and t.pnl_treatment = 'expense')
        or (t.ledger = 'payments' and coalesce(t.category, '') not in ('refund', 'dispute', 'settlement'))
    )), 0) as expense_total,
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

-- ── Payment health (rolling 90 days) — PG payments only ──────────────────────
create or replace view vw_metrics_payment_health as
select
  t.org_id,
  count(*) filter (where t.type = 'credit' and t.status = 'completed') as completed_count,
  count(*) filter (where t.type = 'credit' and t.status = 'failed')    as failed_count,
  count(*) filter (where t.type = 'credit' and t.status = 'pending')   as pending_count,
  count(*) filter (where t.type = 'credit' and t.status = 'refunded')  as refunded_count,
  coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'credit' and t.status = 'completed'), 0) as net_completed_volume,
  coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'credit' and t.status in ('completed', 'refunded')), 0) as gross_volume,
  coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'debit' and t.category = 'refund'), 0)
  + coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'credit' and t.status = 'refunded'), 0) as refund_amount,
  count(*) filter (where t.category = 'dispute')                       as dispute_count,
  coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.category = 'dispute'), 0)                          as dispute_amount
from transactions t
where t.transaction_date <= current_date
  and t.transaction_date >= current_date - interval '90 days'
  and t.ledger = 'payments'
  and coalesce(t.category, '') <> 'settlement'
  and coalesce(t.source, '') !~* '(settlement|payout)'
group by t.org_id;

-- ── Customer snapshot (rolling 90 days) — PG payments only ───────────────────
create or replace view vw_metrics_customers as
select
  t.org_id,
  count(distinct lower(t.counterparty_name))
    filter (where coalesce(t.counterparty_name, '') <> '') as paying_customers,
  coalesce(sum(coalesce(t.amount_base, t.amount)), 0)      as net_revenue,
  count(*)                                                 as txn_count
from transactions t
where t.transaction_date <= current_date
  and t.transaction_date >= current_date - interval '90 days'
  and t.type = 'credit' and t.status = 'completed'
  and t.ledger = 'payments'
  and coalesce(t.category, '') <> 'settlement'
  and coalesce(t.source, '') !~* '(settlement|payout)'
group by t.org_id;

-- ── Lifetime totals — inflow = PG revenue; outflow = real expenses ───────────
create or replace view vw_metrics_totals as
select
  t.org_id,
  coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'credit' and t.ledger = 'payments' and t.status = 'completed'), 0) as lifetime_inflow,
  coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'debit' and (
        (t.ledger = 'bank' and t.pnl_treatment = 'expense')
        or (t.ledger = 'payments' and coalesce(t.category, '') not in ('dispute', 'settlement'))
    )), 0) as lifetime_outflow
from transactions t
where t.transaction_date <= current_date
  and coalesce(t.category, '') <> 'settlement'
  and coalesce(t.source, '') !~* '(settlement|payout)'
group by t.org_id;

grant select on vw_metrics_monthly, vw_metrics_payment_health, vw_metrics_customers, vw_metrics_totals
  to authenticated, anon, service_role;

-- ── Expense Breakdown — real operating expenses, by category ─────────────────
-- Now populated by categorized BANK debits (treatment='expense'); payments-ledger
-- debits that aren't refund/dispute/settlement still contribute (historically ~0).
create or replace view vw_category_breakdown as
with expense_rows as (
  select t.org_id, t.category, coalesce(t.amount_base, t.amount) as amt
  from transactions t
  where t.status in ('completed', 'refunded')
    and t.type = 'debit'
    and (
      (t.ledger = 'bank' and t.pnl_treatment = 'expense')
      or (t.ledger = 'payments' and coalesce(t.category, '') not in ('refund', 'dispute', 'settlement'))
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
  -- Resolve the taxonomy label (org-specific wins over system default); fall back
  -- to a de-slugged form for legacy/free-text categories.
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
order by a.org_id, a.total_amount desc;

-- ── Revenue-by-month (legacy view) — PG payments only ────────────────────────
create or replace view vw_revenue_by_month as
select
  org_id,
  date_trunc('month', transaction_date)::date          as month,
  coalesce(sum(amount) filter (
    where type = 'credit' and ledger = 'payments'
    and (category is null or category != 'settlement')
  ), 0)                                                as total_credits,
  coalesce(sum(amount) filter (where type = 'debit'),  0) as total_debits,
  coalesce(sum(amount) filter (
    where type = 'credit' and ledger = 'payments'
    and (category is null or category != 'settlement')
  ), 0)
    - coalesce(sum(amount) filter (where type = 'debit'), 0) as net
from transactions
where status in ('completed', 'refunded')
group by org_id, date_trunc('month', transaction_date);

-- ── Bank-only rollups for the Bank dashboard (security_invoker) ──────────────
-- security_invoker → respects the caller's RLS on transactions (owner-only), so
-- bank detail is visible only to the owner (client) and the service role (the
-- admin-gated Bank dashboard). Non-owner members see nothing here.
create or replace view vw_bank_monthly with (security_invoker = true) as
select
  t.org_id,
  date_trunc('month', t.transaction_date)::date as month,
  coalesce(sum(coalesce(t.amount_base, t.amount)) filter (where t.type = 'debit'  and t.pnl_treatment = 'expense'), 0) as expense_total,
  coalesce(sum(coalesce(t.amount_base, t.amount)) filter (where t.type = 'credit' and t.pnl_treatment = 'income'), 0)  as income_total,
  coalesce(sum(coalesce(t.amount_base, t.amount)) filter (where t.type = 'debit'  and coalesce(t.pnl_treatment, '') = 'excluded'), 0) as excluded_out,
  coalesce(sum(coalesce(t.amount_base, t.amount)) filter (where t.type = 'credit' and coalesce(t.pnl_treatment, '') = 'excluded'), 0) as excluded_in,
  count(*) filter (where coalesce(t.pnl_treatment, 'uncategorized') = 'uncategorized') as uncategorized_count,
  count(*) as txn_count
from transactions t
where t.ledger = 'bank' and t.status in ('completed', 'refunded')
group by t.org_id, date_trunc('month', t.transaction_date);

create or replace view vw_bank_category with (security_invoker = true) as
select
  t.org_id,
  coalesce(t.category, 'uncategorized')       as category,
  coalesce(t.pnl_treatment, 'uncategorized')  as treatment,
  t.type,
  coalesce(sum(coalesce(t.amount_base, t.amount)), 0) as total_amount,
  count(*) as transaction_count
from transactions t
where t.ledger = 'bank' and t.status in ('completed', 'refunded')
group by t.org_id, coalesce(t.category, 'uncategorized'), coalesce(t.pnl_treatment, 'uncategorized'), t.type;

grant select on vw_bank_monthly, vw_bank_category to authenticated, anon, service_role;
