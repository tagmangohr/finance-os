-- 074_pnl_drill_groups.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Consolidated (grouped-by-counterparty) drill-down for a P&L cell.
--
-- The drawer shows "Anthropic ₹38,34,901 · Byteplus ₹11,90,871 · …" instead of a
-- flat transaction list. Grouping happens IN Postgres so a revenue slice with
-- thousands of distinct customers never streams every row into the app to sum in
-- JS (the timeout the rollups exist to avoid). Filters mirror the JS flat-drill in
-- /api/pnl/drill exactly, per slice key:
--   'revenue'      credit · payments · posted
--   'refunds'      payments · (debit+refund | credit+refunded)
--   '__pg_fees__'  posted rows carrying metadata.fee/fees (amount = INR fee)
--   <slug>         expense rows in that category (bank-expense both dirs + payments debit)
-- Returns top groups by |amount| plus one extra sentinel row so the caller can tell
-- whether more groups exist. The authoritative slice TOTAL stays the rollup value
-- the client already holds — this RPC is only the vendor/customer split.
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
      coalesce(nullif(t.counterparty_name, ''), '—') as name,
      case
        when p_key = '__pg_fees__' then _pnl_fee(t)
        -- expense slugs: bank credit reversals net off (signed), payments debits positive
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
