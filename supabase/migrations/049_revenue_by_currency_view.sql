-- ============================================================
-- FILE: 049_revenue_by_currency_view.sql
-- Per-currency revenue rollup for the Revenue page's currency breakdown, so the
-- page can read a pre-aggregated view instead of draining a full year of raw
-- transactions into JS (the old path also had a null-category bug — see below).
--
-- Same firewall filters as vw_metrics_monthly (the canonical revenue definition):
--   credit + ledger='payments' + status in (completed,refunded), excluding
--   settlement category + settlement/payout sources. Crucially NULL-SAFE:
--   `coalesce(category,'') <> 'settlement'` keeps the ~75k null-category PG rows
--   that the app's `.not('category','eq','settlement')` was silently dropping
--   (which undercounted Revenue-page revenue ~3x vs the dashboard).
-- ============================================================

create or replace view vw_revenue_by_currency as
select
  t.org_id,
  t.currency,
  coalesce(sum(t.amount), 0)                          as original,
  coalesce(sum(coalesce(t.amount_base, t.amount)), 0) as inr
from transactions t
where t.type = 'credit'
  and t.ledger = 'payments'
  and t.status in ('completed', 'refunded')
  and t.transaction_date <= current_date
  and t.transaction_date >= (date_trunc('month', current_date) - interval '13 months')::date
  and coalesce(t.category, '') <> 'settlement'
  and coalesce(t.source, '') !~* '(settlement|payout)'
group by t.org_id, t.currency;

grant select on vw_revenue_by_currency to authenticated, anon, service_role;
