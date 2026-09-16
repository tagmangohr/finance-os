-- 126_bank_overview_pending.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Add pending totals to the Bank-overview aggregate.
--
-- The Bank page's first card is changing from "Net P&L" to "Pending" — the gross
-- amount + count of transactions currently in status='pending' (unsettled), in the
-- selected range. We compute it in the SAME single indexed pass as the rest of the
-- aggregate (over the existing `base` CTE), so it adds no extra query and no extra
-- round-trip. Everything else in the function is byte-for-byte identical to 089.
--
-- Semantics: pending_amount = sum of coalesce(amount_base, amount) over base rows
-- with status='pending' (GROSS, direction-agnostic — "money awaiting settlement");
-- pending_count = how many such rows. Split parents are already excluded by `base`.
--
-- Security: CREATE OR REPLACE preserves the existing ACL, but we re-assert the
-- 103 lockdown (revoke from anon/authenticated; execute is service_role only —
-- the Bank page calls this with the service client) and the 104 `security invoker`
-- posture explicitly, so this migration is self-contained and can't silently
-- re-open the function.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function bank_overview_agg(p_org uuid, p_from date, p_to date)
returns jsonb language sql stable security invoker as $$
  with base as (
    select * from transactions
    where org_id = p_org and ledger = 'bank' and is_split_parent = false
      and transaction_date >= p_from and transaction_date <= p_to
  ),
  posted as (
    select * from base where status in ('completed', 'refunded')
  ),
  bycat as (
    select category,
      sum(case when type = 'debit' then coalesce(amount_base, amount) else -coalesce(amount_base, amount) end) as amount,
      count(*) as cnt
    from posted
    where pnl_treatment = 'expense' and conn_include_expense
    group by category
    having abs(sum(case when type = 'debit' then coalesce(amount_base, amount) else -coalesce(amount_base, amount) end)) > 0.5
  ),
  tot as (
    select
      coalesce(sum(case when pnl_treatment = 'expense' and conn_include_expense
        then (case when type = 'debit' then coalesce(amount_base, amount) else -coalesce(amount_base, amount) end) else 0 end), 0) as expenses,
      coalesce(sum(case when pnl_treatment = 'income' and conn_include_income
        then (case when type = 'credit' then coalesce(amount_base, amount) else -coalesce(amount_base, amount) end) else 0 end), 0) as other_income,
      coalesce(sum(case when pnl_treatment = 'excluded' then coalesce(amount_base, amount) else 0 end), 0) as excluded,
      coalesce(sum(case when pnl_treatment is null or pnl_treatment = 'uncategorized' then 1 else 0 end), 0) as uncategorized_count
    from posted
  ),
  cnts as (
    select
      count(*) as txn_count,
      coalesce(sum(case when pnl_treatment is null or pnl_treatment = 'uncategorized'
        or (category_source = 'ai' and coalesce(category_confidence, 1) < 0.6) then 1 else 0 end), 0) as review_count
    from base
  ),
  pend as (
    select
      coalesce(sum(coalesce(amount_base, amount)), 0) as pending_amount,
      count(*) as pending_count
    from base where status = 'pending'
  ),
  filt as (
    select
      coalesce((select jsonb_agg(distinct account_type order by account_type) from base where account_type is not null), '[]'::jsonb) as account_types,
      coalesce((select jsonb_agg(distinct card_last4  order by card_last4)  from base where card_last4  is not null), '[]'::jsonb) as cards
  )
  select jsonb_build_object(
    'expenses',           (select expenses from tot),
    'otherIncome',        (select other_income from tot),
    'excluded',           (select excluded from tot),
    'uncategorizedCount', (select uncategorized_count from tot),
    'txnCount',           (select txn_count from cnts),
    'reviewCount',        (select review_count from cnts),
    'pendingAmount',      (select pending_amount from pend),
    'pendingCount',       (select pending_count from pend),
    'byCategory',         coalesce((select jsonb_agg(jsonb_build_object('category', category, 'amount', amount, 'count', cnt) order by amount desc) from bycat), '[]'::jsonb),
    'accountTypes',       (select account_types from filt),
    'cards',              (select cards from filt)
  );
$$;

-- Re-assert the 103 lockdown: this reader is service-role only.
revoke execute on function bank_overview_agg(uuid, date, date) from anon, authenticated;
grant  execute on function bank_overview_agg(uuid, date, date) to service_role;
