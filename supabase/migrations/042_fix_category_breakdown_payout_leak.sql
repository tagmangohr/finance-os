-- ============================================================
-- FILE: 042_fix_category_breakdown_payout_leak.sql
-- Fix: PG payout/settlement debits leaked into the Expense Breakdown.
--
-- vw_category_breakdown counted payments-ledger debits with `coalesce(category,
-- '') not in ('refund','dispute','settlement')`. Stripe payout debits carry a
-- NULL category and source 'stripe_payout' — the coalesce turned NULL into '',
-- so they passed the filter and showed up as a huge "Uncategorized" expense
-- (≈₹2.66Cr), inconsistent with expense_total in vw_metrics_monthly (which
-- correctly excludes payouts via its `source !~* '(settlement|payout)'` filter).
--
-- Fix: add the SAME source exclusion to the breakdown so payouts/settlements are
-- never counted as expenses. Keeps the reversal net-off (debit − credit) from 041.
-- ============================================================

create or replace view vw_category_breakdown as
with expense_rows as (
  select
    t.org_id,
    t.category,
    (case when t.type = 'debit' then 1 else -1 end) * coalesce(t.amount_base, t.amount) as amt
  from transactions t
  where t.status in ('completed', 'refunded')
    -- Exclude gateway payouts/settlements (already-counted revenue moving to the
    -- bank) — matches the guard in vw_metrics_monthly.
    and coalesce(t.source, '') !~* '(settlement|payout)'
    and (
      (t.ledger = 'bank' and t.pnl_treatment = 'expense')                                        -- both directions (spend − reversal)
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
