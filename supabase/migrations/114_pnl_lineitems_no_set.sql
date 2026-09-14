-- 114_pnl_lineitems_no_set.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Hotfix: 111/113 declared pnl_lineitems_monthly `language plpgsql STABLE` with a
-- `SET LOCAL statement_timeout` in the body. Postgres allows SET only in VOLATILE
-- functions, so the function CREATED fine but every CALL failed at runtime with
-- "SET is not allowed in a non-volatile function" — the Expand feature could never
-- load. Recreate the function WITHOUT the SET (keep STABLE; the API route's
-- maxDuration bounds the call). Body is otherwise identical to the corrected 113.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function pnl_lineitems_monthly(p_org uuid, p_from date, p_to date)
returns table(month date, drill_key text, party text, amount numeric, txn_count bigint)
language plpgsql stable as $$
begin
  return query

  -- EXPENSES by vendor — SAME row set as rebuild_pnl_rollups (no type filter);
  -- _dm_expense_m + HAVING decide, so Σ(vendors) ≡ category total. Never add a
  -- type/ledger prefilter here (that dropped refund credits → the Mornell bug).
  select date_trunc('month', t.transaction_date)::date,
         _pnl_expense_cat(t),
         coalesce(nullif(btrim(t.counterparty_name), ''), '—'),
         sum(_dm_expense_m(t)),
         count(*) filter (where _dm_expense_m(t) <> 0)
  from transactions t
  where t.org_id = p_org
    and t.transaction_date >= p_from and t.transaction_date <= p_to
  group by 1, 2, 3
  having sum(_dm_expense_m(t)) <> 0

  union all
  -- PAYMENT GATEWAY FEES by gateway
  select date_trunc('month', t.transaction_date)::date,
         '__pg_fees__',
         case when t.source like 'app_store%' then 'app_store'
              else coalesce(nullif(split_part(coalesce(t.source, ''), '_', 1), ''), '—') end,
         sum(_pnl_fee(t)),
         count(*) filter (where _pnl_fee(t) <> 0)
  from transactions t
  where t.org_id = p_org
    and t.transaction_date >= p_from and t.transaction_date <= p_to
    and (t.metadata ->> 'fee' is not null or t.metadata ->> 'fees' is not null)
  group by 1, 2, 3
  having sum(_pnl_fee(t)) <> 0

  union all
  -- GROSS REVENUE (PG + sales credits) by gateway
  select date_trunc('month', t.transaction_date)::date,
         'revenue',
         case when t.source like 'app_store%' then 'app_store'
              else coalesce(nullif(split_part(coalesce(t.source, ''), '_', 1), ''), '—') end,
         sum(_dm_gross(t)),
         count(*) filter (where _dm_gross(t) <> 0)
  from transactions t
  where t.org_id = p_org
    and t.transaction_date >= p_from and t.transaction_date <= p_to
    and t.type = 'credit'
  group by 1, 2, 3
  having sum(_dm_gross(t)) <> 0

  union all
  -- GROSS REVENUE bank-collected customer payments, by payer
  select date_trunc('month', t.transaction_date)::date,
         'revenue',
         'bank:' || coalesce(nullif(btrim(t.counterparty_name), ''), '—'),
         sum(case when t.type = 'credit' then _dm_base(t) else -_dm_base(t) end),
         count(*)
  from transactions t
  where t.org_id = p_org
    and t.transaction_date >= p_from and t.transaction_date <= p_to
    and t.ledger = 'bank' and t.pnl_treatment = 'income'
    and t.category = 'customer_payment'
    and t.conn_include_income
    and t.status in ('completed', 'refunded')
  group by 1, 2, 3
  having sum(case when t.type = 'credit' then _dm_base(t) else -_dm_base(t) end) <> 0

  union all
  -- REFUNDS by gateway
  select date_trunc('month', t.transaction_date)::date,
         'refunds',
         case when t.source like 'app_store%' then 'app_store'
              else coalesce(nullif(split_part(coalesce(t.source, ''), '_', 1), ''), '—') end,
         sum(_dm_refunds(t)),
         count(*) filter (where _dm_refunds(t) <> 0)
  from transactions t
  where t.org_id = p_org
    and t.transaction_date >= p_from and t.transaction_date <= p_to
    and t.type = 'debit'
  group by 1, 2, 3
  having sum(_dm_refunds(t)) <> 0

  union all
  -- OTHER INCOME (non customer_payment bank income) by payer, per category
  select date_trunc('month', t.transaction_date)::date,
         'income:' || coalesce(nullif(t.category, ''), 'other_income'),
         coalesce(nullif(btrim(t.counterparty_name), ''), '—'),
         sum(case when t.type = 'credit' then _dm_base(t) else -_dm_base(t) end),
         count(*)
  from transactions t
  where t.org_id = p_org
    and t.transaction_date >= p_from and t.transaction_date <= p_to
    and t.ledger = 'bank' and t.pnl_treatment = 'income'
    and t.conn_include_income
    and t.status in ('completed', 'refunded')
    and coalesce(nullif(t.category, ''), 'other_income') <> 'customer_payment'
  group by 1, 2, 3
  having sum(case when t.type = 'credit' then _dm_base(t) else -_dm_base(t) end) <> 0;

end $$;

revoke execute on function pnl_lineitems_monthly(uuid, date, date) from anon, authenticated;
grant  execute on function pnl_lineitems_monthly(uuid, date, date) to service_role;
