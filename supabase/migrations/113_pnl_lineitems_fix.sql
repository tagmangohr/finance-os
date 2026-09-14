-- 113_pnl_lineitems_fix.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Fixes to pnl_lineitems_monthly (111) found in adversarial review:
--
--  1. CRITICAL tie-out bug. _dm_expense_m (099) counts BOTH debit operating spend
--     AND a CREDIT branch (bank expense reversals / refunds, which net the expense
--     DOWN by -amount). The expense line-item branch pre-filtered `type='debit'`,
--     dropping those reversal credits — so a category with a refund showed vendor
--     sub-rows that summed HIGHER than the (net) category total. Widen the
--     pre-filter to the true superset: all debits PLUS bank-expense credits.
--
--  2. SECURITY. 111 granted EXECUTE to anon/authenticated, reversing the 103
--     lockdown (every per-org reader is service_role-only; the API route holds the
--     service client and the access check). Revoke the public grants.
--
--  4. App Store / gateway keying. Money-in parties keyed on split_part(source,'_')
--     turned 'app_store' into 'app' — a wrong label and a drill that ilike-matches
--     'app%'. Mirror the drill route: app_store keeps its full stem. (Tie-out is
--     unaffected either way — the grouping key never changes the per-line sum.)
--
-- create-or-replace keeps the row logic identical elsewhere; only the expense
-- pre-filter and the money-in party key change. Re-run is idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function pnl_lineitems_monthly(p_org uuid, p_from date, p_to date)
returns table(month date, drill_key text, party text, amount numeric, txn_count bigint)
language plpgsql stable as $$
begin
  -- NOTE: no `set local statement_timeout` here — SET is rejected inside a STABLE
  -- function ("SET is not allowed in a non-volatile function"). The API route's
  -- maxDuration bounds the call instead. Superseded/corrected by 114.
  return query

  -- ── EXPENSES by vendor (ties to each expense category row) ──────────────────
  -- BULLETPROOF tie-out: this uses the SAME row set as rebuild_pnl_rollups (073)
  -- — every row in the window, no type filter — grouped by the SAME expression
  -- (_pnl_expense_cat) and summed through the SAME function (_dm_expense_m). The
  -- category total is that exact aggregation without the counterparty split, so
  -- Σ(vendors) ≡ category total by construction. A type prefilter here once broke
  -- this: _dm_expense_m counts BOTH debit spend AND bank-expense REVERSAL credits
  -- (099), so `type='debit'` dropped refunds and overstated any refunded category
  -- (the Mornell Trust case). Never reintroduce a type/ledger prefilter on this
  -- branch — let _dm_expense_m + the HAVING decide, exactly as the rollup does.
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
  -- ── PAYMENT GATEWAY FEES by gateway (ties to the __pg_fees__ row) ────────────
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
  -- ── GROSS REVENUE (PG + sales credits) by gateway ───────────────────────────
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
  -- ── GROSS REVENUE bank-collected customer payments, by payer ────────────────
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
  -- ── REFUNDS by gateway (ties to the Refunds row) ────────────────────────────
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
  -- ── OTHER INCOME (non customer_payment bank income) by payer, per category ───
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

-- Security: readers are service_role-only (103 baseline). The API route checks
-- 'pnl' page access and calls with the service client.
revoke execute on function pnl_lineitems_monthly(uuid, date, date) from anon, authenticated;
grant  execute on function pnl_lineitems_monthly(uuid, date, date) to service_role;
