-- 073_pnl_rollups.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Month-wise, Excel-style Profit & Loss.
--
-- The P&L needs, per month:
--   • Gross revenue + refunds  → already served FAST by dash_metrics_monthly (068).
--   • Expenses broken down BY CATEGORY → NOT available anywhere (the 068 daily
--     rollup keeps expense_total but drops the category dimension; vw_category_
--     breakdown has categories but is all-time, not per-month). Scanning the raw
--     ~400k-row transactions table per page load would hit the statement timeout.
--   • Payment-gateway/App-Store fees → live in metadata.fee (original currency),
--     never rolled up.
--
-- Fix: a SEPARATE, self-contained rollup at org × day × category grain, on the
-- exact same trigger pattern as 068 — so nothing scans raw rows and the dashboard
-- rollups (rollup_metrics_daily) are never touched. Expense semantics REUSE the
-- existing _dm_expense_m/_dm_excluded helpers, so the per-category rows sum
-- EXACTLY to dash_metrics_monthly.expense_total (no drift). Fees are stored under
-- a reserved category slug '__pg_fees__' using the SAME INR-conversion formula as
-- transactions_summary_groups (052), so the fee line matches the Payments cards.
-- ─────────────────────────────────────────────────────────────────────────────

-- Fee for a row, in INR. Prefer metadata.fee, fall back to metadata.fees; only a
-- clean numeric string is counted (a stray non-numeric value can't poison the sum).
-- FX-convert non-INR rows via fx_rate. Counted only for POSTED, non-excluded rows
-- (fees ride on the revenue transaction, whose status governs whether it counts).
create or replace function _pnl_fee(r transactions) returns numeric language sql immutable as $$
  select case
    when _dm_excluded(r) then 0
    when r.status not in ('completed','refunded') then 0
    when coalesce(r.metadata->>'fee', r.metadata->>'fees') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (coalesce(r.metadata->>'fee', r.metadata->>'fees'))::numeric
           * case when r.currency <> 'INR' then coalesce(r.fx_rate, 1) else 1 end
    else 0 end;
$$;

-- Expense category slug for a row's expense contribution (empty/NULL → 'uncategorized').
create or replace function _pnl_expense_cat(r transactions) returns text language sql immutable as $$
  select coalesce(nullif(r.category, ''), 'uncategorized');
$$;

-- ── Rollup table (org × day × category) ─────────────────────────────────────
-- category is the expense category slug, OR the reserved '__pg_fees__' for fees.
create table if not exists rollup_pnl_cat_day (
  org_id   uuid    not null,
  day      date    not null,
  category text    not null,
  amount   numeric not null default 0,
  primary key (org_id, day, category)
);
create index if not exists idx_rollup_pnl_day on rollup_pnl_cat_day (org_id, day);

-- ── Applier (idempotent add) ────────────────────────────────────────────────
create or replace function _pnl_apply(p_org uuid, p_day date, p_cat text, p_delta numeric) returns void language plpgsql as $$
begin
  if p_delta = 0 or p_cat is null then return; end if;
  insert into rollup_pnl_cat_day as m (org_id, day, category, amount)
  values (p_org, p_day, p_cat, p_delta)
  on conflict (org_id, day, category) do update set amount = m.amount + excluded.amount;
end $$;

-- ── Trigger: apply -OLD then +NEW (expense contribution + fee contribution) ──
create or replace function trg_pnl_rollup() returns trigger language plpgsql as $$
begin
  if TG_OP in ('UPDATE','DELETE') and OLD.transaction_date is not null then
    perform _pnl_apply(OLD.org_id, OLD.transaction_date, _pnl_expense_cat(OLD), -_dm_expense_m(OLD));
    perform _pnl_apply(OLD.org_id, OLD.transaction_date, '__pg_fees__',        -_pnl_fee(OLD));
  end if;
  if TG_OP in ('INSERT','UPDATE') and NEW.transaction_date is not null then
    perform _pnl_apply(NEW.org_id, NEW.transaction_date, _pnl_expense_cat(NEW),  _dm_expense_m(NEW));
    perform _pnl_apply(NEW.org_id, NEW.transaction_date, '__pg_fees__',          _pnl_fee(NEW));
  end if;
  return null;
end $$;
drop trigger if exists trg_pnl_rollup on transactions;
create trigger trg_pnl_rollup after insert or update or delete on transactions for each row execute function trg_pnl_rollup();

-- ── Full rebuild (initial populate + safety net) ────────────────────────────
create or replace function rebuild_pnl_rollups() returns void language plpgsql security definer as $$
begin
  set local statement_timeout = 0;
  truncate rollup_pnl_cat_day;
  -- Expense rows, netted per category (matches _dm_expense_m exactly).
  insert into rollup_pnl_cat_day (org_id, day, category, amount)
    select t.org_id, t.transaction_date, _pnl_expense_cat(t), sum(_dm_expense_m(t))
    from transactions t
    where t.transaction_date is not null
    group by t.org_id, t.transaction_date, _pnl_expense_cat(t)
    having sum(_dm_expense_m(t)) <> 0
  on conflict (org_id, day, category) do update set amount = rollup_pnl_cat_day.amount + excluded.amount;
  -- Fee rows, under the reserved slug.
  insert into rollup_pnl_cat_day (org_id, day, category, amount)
    select t.org_id, t.transaction_date, '__pg_fees__', sum(_pnl_fee(t))
    from transactions t
    where t.transaction_date is not null
    group by t.org_id, t.transaction_date
    having sum(_pnl_fee(t)) <> 0
  on conflict (org_id, day, category) do update set amount = rollup_pnl_cat_day.amount + excluded.amount;
end $$;

-- ── Read RPC: month × category with resolved labels ─────────────────────────
create or replace function pnl_monthly(p_org uuid, p_from date, p_to date)
returns table(month date, category text, label text, amount numeric)
language sql stable as $$
  with agg as (
    select date_trunc('month', day)::date as month, category, sum(amount) as amount
    from rollup_pnl_cat_day
    where org_id = p_org and day >= p_from and day <= p_to
    group by 1, 2
  )
  select
    a.month,
    a.category,
    case when a.category = '__pg_fees__' then 'Payment Gateway Fees'
         else coalesce(lc.label, initcap(replace(a.category, '_', ' ')), 'Uncategorized') end as label,
    a.amount
  from agg a
  left join lateral (
    select lc.label from ledger_categories lc
    where lc.slug = a.category and (lc.org_id = p_org or lc.org_id is null)
    order by (lc.org_id is not null) desc
    limit 1
  ) lc on true
  where a.amount <> 0
  order by a.month, a.amount desc;
$$;

select rebuild_pnl_rollups();

grant select on rollup_pnl_cat_day to authenticated, anon, service_role;
grant insert, update, delete on rollup_pnl_cat_day to service_role;
grant execute on function rebuild_pnl_rollups(), pnl_monthly(uuid, date, date) to authenticated, anon, service_role;
