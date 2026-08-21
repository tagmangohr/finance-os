-- 076_pnl_drill_gateway_normalize.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Two drill fixes so the vendor/gateway split matches the P&L cell exactly:
--
-- 1) Exclude settlements/payouts. Settlements are just PG→bank transfers (already
--    counted revenue moving to the bank); the rollups drop them via _dm_excluded,
--    but the drill didn't — so "Cashfree Settlement" / "Razorpay Settlement" leaked
--    into the gateway split. Add `and not _dm_excluded(t)` (identical guard).
--
-- 2) Group money-in by GATEWAY, not raw source. "stripe" and "stripe_refund" are
--    distinct source strings, so they showed as two rows ("Stripe" + "Stripe
--    Refund"). Collapse to the gateway stem (app_store kept whole) so each gateway
--    appears once: Stripe, Razorpay, Cashfree, Apple Pay, …
-- Expense lines still group by vendor (counterparty_name).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function pnl_drill_groups(
  p_org  uuid,
  p_key  text,
  p_from date,
  p_to   date,
  p_limit int default 50
)
returns table(name text, amount numeric, txn_count bigint)
language sql
stable
security invoker
as $$
  with base as (
    select
      case
        when p_key in ('revenue','refunds','__pg_fees__') then
          coalesce(nullif(
            case when t.source like 'app_store%' then 'app_store'
                 else split_part(coalesce(t.source, ''), '_', 1) end, ''), '—')
        else coalesce(nullif(t.counterparty_name, ''), '—')
      end as name,
      case
        when p_key = '__pg_fees__' then _pnl_fee(t)
        when p_key not in ('revenue','refunds') and t.type = 'credit' then -coalesce(t.amount_base, t.amount, 0)
        else coalesce(t.amount_base, t.amount, 0)
      end as amt
    from transactions t
    where t.org_id = p_org
      and t.transaction_date >= p_from
      and t.transaction_date <= p_to
      and not _dm_excluded(t)                        -- drop settlements/payouts (matches the rollup)
      and case
        when p_key = 'revenue' then
          t.type = 'credit' and t.ledger = 'payments' and t.status in ('completed','refunded')
        when p_key = 'refunds' then
          t.ledger = 'payments' and (
            (t.type = 'debit' and t.category = 'refund') or (t.type = 'credit' and t.status = 'refunded')
          )
        when p_key = '__pg_fees__' then
          t.status in ('completed','refunded') and _pnl_fee(t) <> 0
        when p_key = 'uncategorized' then
          t.status in ('completed','refunded')
          and ((t.ledger = 'bank' and t.pnl_treatment = 'expense') or (t.ledger = 'payments' and t.type = 'debit'))
          and coalesce(t.category, '') = ''
        else
          t.status in ('completed','refunded')
          and ((t.ledger = 'bank' and t.pnl_treatment = 'expense') or (t.ledger = 'payments' and t.type = 'debit'))
          and t.category = p_key
      end
  ),
  grouped as (
    select name, sum(amt) as amount, count(*) as txn_count
    from base
    group by name
    having sum(amt) <> 0
  )
  select name, amount, txn_count
  from grouped
  order by abs(amount) desc, txn_count desc
  limit p_limit;
$$;

grant execute on function pnl_drill_groups(uuid, text, date, date, int) to authenticated, anon, service_role;
