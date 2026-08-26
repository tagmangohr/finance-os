-- 089_bank_overview_agg.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Fast Bank-overview aggregation for high-volume ledgers (100k+ bank rows).
--
-- getBankOverview() used to keyset-DRAIN every bank row into JS to compute the
-- cards / by-category list / review count / filter options — ~100 round-trips and
-- a slow page load at 100k rows. This RPC computes all of it in ONE indexed
-- aggregation (uses idx_transactions_bank), returning a single jsonb blob, so the
-- Bank page loads in ~1-2s regardless of volume.
--
-- Semantics MIRROR the old JS loop exactly:
--   • split PARENTS excluded (children carry the real amounts);
--   • P&L totals (expenses / other income / excluded / by-category) over POSTED
--     rows only (completed|refunded), respecting the per-connector income/expense
--     toggles (conn_include_*); expenses/income are direction-aware (debit vs credit);
--   • review count / txn count / distinct account_types + cards over ALL statuses.
-- Category LABELS are resolved in JS (the caller already has the taxonomy).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function bank_overview_agg(p_org uuid, p_from date, p_to date)
returns jsonb language sql stable as $$
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
    'byCategory',         coalesce((select jsonb_agg(jsonb_build_object('category', category, 'amount', amount, 'count', cnt) order by amount desc) from bycat), '[]'::jsonb),
    'accountTypes',       (select account_types from filt),
    'cards',              (select cards from filt)
  );
$$;

grant execute on function bank_overview_agg(uuid, date, date) to authenticated, anon, service_role;
