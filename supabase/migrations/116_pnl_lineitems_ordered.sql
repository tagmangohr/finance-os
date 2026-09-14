-- 116_pnl_lineitems_ordered.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Make pnl_lineitems_monthly SAFE TO PAGINATE.
--
-- PostgREST caps every response at db-max-rows (1000 here). A full FY expand can
-- exceed that (measured: 1205 rows over a multi-year range), so the API route must
-- fetch the result in pages of 1000 via Range. Offset paging is only correct if the
-- result has a DETERMINISTIC order — otherwise two page requests can re-order the
-- groups and silently drop/duplicate rows (which showed up as vendor sub-rows not
-- summing to the row total once past row 1000). The prior definition had no ORDER
-- BY. Wrap the unions in a stable ORDER BY so paging is exact. Logic is byte-for-
-- byte identical to 115 — only the outer ordering is added.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function pnl_lineitems_monthly(p_org uuid, p_from date, p_to date)
returns table(month date, drill_key text, party text, amount numeric, txn_count bigint)
language sql stable as $$
  select q.month, q.drill_key, q.party, q.amount, q.txn_count
  from (
    -- REVENUE by gateway (rollup)
    select date_trunc('month', day)::date as month, 'revenue' as drill_key, gateway as party,
           sum(amount) as amount, 0::bigint as txn_count
    from rollup_revenue_gateway_day
    where org_id = p_org and day >= p_from and day <= p_to
    group by 1, 3 having sum(amount) <> 0

    union all
    -- PAYMENT GATEWAY FEES by gateway (rollup)
    select date_trunc('month', day)::date, '__pg_fees__', gateway, sum(amount), 0::bigint
    from rollup_fees_gateway_day
    where org_id = p_org and day >= p_from and day <= p_to
    group by 1, 3 having sum(amount) <> 0

    union all
    -- EXPENSES by vendor (raw; safe superset of _dm_expense_m — debits OR bank-expense)
    select date_trunc('month', t.transaction_date)::date,
           _pnl_expense_cat(t),
           coalesce(nullif(btrim(t.counterparty_name), ''), '—'),
           sum(_dm_expense_m(t)),
           count(*) filter (where _dm_expense_m(t) <> 0)
    from transactions t
    where t.org_id = p_org
      and t.transaction_date >= p_from and t.transaction_date <= p_to
      and (t.type = 'debit' or (t.ledger = 'bank' and t.pnl_treatment = 'expense'))
    group by 1, 2, 3 having sum(_dm_expense_m(t)) <> 0

    union all
    -- REFUNDS by gateway (raw; debits)
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
    group by 1, 2, 3 having sum(_dm_refunds(t)) <> 0

    union all
    -- GROSS REVENUE bank-collected customer payments, by payer (raw)
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
    group by 1, 2, 3 having sum(case when t.type = 'credit' then _dm_base(t) else -_dm_base(t) end) <> 0

    union all
    -- OTHER INCOME (non customer_payment bank income) by payer, per category (raw)
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
    group by 1, 2, 3 having sum(case when t.type = 'credit' then _dm_base(t) else -_dm_base(t) end) <> 0
  ) q(month, drill_key, party, amount, txn_count)
  -- Deterministic order → correct offset pagination in the API route.
  order by q.month, q.drill_key, abs(q.amount) desc, q.party;
$$;

revoke execute on function pnl_lineitems_monthly(uuid, date, date) from anon, authenticated;
grant  execute on function pnl_lineitems_monthly(uuid, date, date) to service_role;
