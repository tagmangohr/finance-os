-- 075_pnl_drill_by_gateway.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Revenue / Refunds / Payment Gateway Fees should drill down BY GATEWAY (source:
-- cashfree, stripe, razorpay, app_store …) — not by customer. Expense categories
-- keep grouping by vendor (counterparty_name). Only the grouping key changes vs
-- 074; all slice filters are identical.
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
      -- Money-in lines split by gateway; expense lines split by vendor.
      case
        when p_key in ('revenue','refunds','__pg_fees__') then coalesce(nullif(t.source, ''), '—')
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
