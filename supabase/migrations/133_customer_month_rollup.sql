-- 133_customer_month_rollup.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- FIX: Revenue blank on P&L + Dashboard (statement timeout).
--
-- Root cause (measured in prod): dash_metrics_monthly() returned gross_revenue AND
-- paying_customers in one query. The gross sum (over rollup_metrics_daily, ~460
-- rows/org) is cheap, but paying_customers = count(DISTINCT cust_key) over
-- rollup_customer_day — a per (org, day, customer) table so large for a high-volume
-- org that even a plain row-count over the window exceeds the 8s API statement
-- limit. The whole RPC timed out → the P&L's gross map came back empty → the
-- "Gross Revenue" line rendered blank, while expenses (a SEPARATE rollup/RPC) still
-- rendered. The Dashboard broke the same way (same RPC is its primary path; its
-- fallback view vw_metrics_monthly scans the 550k-row raw table and also times out).
--
-- Fix: precompute distinct paying customers at (org, MONTH, customer) grain in a
-- trigger-maintained rollup, so "distinct customers in a month" = a cheap COUNT(*)
-- of month rows (one row per customer per month, cnt>0) — no DISTINCT over daily
-- rows. dash_metrics_monthly and vw_metrics_monthly then read it. Return shapes are
-- UNCHANGED, so every caller keeps working — just sub-second instead of timing out.
--
-- The count stays EXACT (it mirrors the day-grain refcount, one grain up). The only
-- metric sourced from the customer rollup is paying_customers; gross/refunds/expense
-- are untouched.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Month-grain customer refcount (mirrors rollup_customer_day from 068) ──
-- One row per (org, month, customer) with a running count; cnt>0 ⇔ the customer
-- had ≥1 qualifying (completed PG payment, non-empty name) transaction that month.
create table if not exists rollup_customer_month (
  org_id   uuid    not null,
  month    date    not null,          -- first-of-month (date_trunc('month', day))
  cust_key text    not null,
  cnt      bigint  not null default 0,
  primary key (org_id, month, cust_key)
);
-- Partial index so count(*) per month is an index-only range scan over live rows.
create index if not exists idx_rollup_cust_month on rollup_customer_month (org_id, month) where cnt > 0;

-- ── 2. Applier (idempotent ± delta), mirror of _dm_apply_cust ────────────────
create or replace function _dm_apply_cust_month(p_org uuid, p_month date, p_key text, p_delta bigint) returns void language plpgsql as $$
begin
  if p_key is null or p_delta = 0 then return; end if;
  insert into rollup_customer_month as c (org_id, month, cust_key, cnt) values (p_org, p_month, p_key, p_delta)
  on conflict (org_id, month, cust_key) do update set cnt = c.cnt + excluded.cnt;
end $$;

-- ── 3. Extend the dashboard rollup trigger to maintain BOTH grains ───────────
-- Verbatim 085 body (keeps the app.skip_rollup guard + daily + day-customer logic);
-- the only additions are the two _dm_apply_cust_month calls (month = trunc of day).
create or replace function trg_dash_rollup() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.skip_rollup', true), '') = 'on' then return null; end if;
  if TG_OP in ('UPDATE','DELETE') and OLD.transaction_date is not null then
    perform _dm_apply_daily(OLD.org_id, OLD.transaction_date,
      -_dm_gross(OLD), -_dm_completed_amt(OLD), -_dm_refunds(OLD), -_dm_expense_m(OLD), -_dm_outflow_l(OLD),
      -_dm_completed_cnt(OLD), -_dm_failed_cnt(OLD), -_dm_pending_cnt(OLD), -_dm_refunded_cnt(OLD), -_dm_dispute_cnt(OLD), -_dm_dispute_amt(OLD));
    perform _dm_apply_cust(OLD.org_id, OLD.transaction_date, _dm_cust_key(OLD), -1);
    perform _dm_apply_cust_month(OLD.org_id, date_trunc('month', OLD.transaction_date)::date, _dm_cust_key(OLD), -1);
  end if;
  if TG_OP in ('INSERT','UPDATE') and NEW.transaction_date is not null then
    perform _dm_apply_daily(NEW.org_id, NEW.transaction_date,
      _dm_gross(NEW), _dm_completed_amt(NEW), _dm_refunds(NEW), _dm_expense_m(NEW), _dm_outflow_l(NEW),
      _dm_completed_cnt(NEW), _dm_failed_cnt(NEW), _dm_pending_cnt(NEW), _dm_refunded_cnt(NEW), _dm_dispute_cnt(NEW), _dm_dispute_amt(NEW));
    perform _dm_apply_cust(NEW.org_id, NEW.transaction_date, _dm_cust_key(NEW), 1);
    perform _dm_apply_cust_month(NEW.org_id, date_trunc('month', NEW.transaction_date)::date, _dm_cust_key(NEW), 1);
  end if;
  return null;
end $$;

-- ── 4. Point the monthly RPC's customer count at the month rollup ────────────
-- Return shape is IDENTICAL to 068; only the `c` CTE changes: count(*) of month
-- rows (= distinct customers that month) instead of count(distinct) over daily rows.
create or replace function dash_metrics_monthly(p_org uuid, p_from date, p_to date)
returns table(month date, gross_revenue numeric, refunds numeric, expense_total numeric, txn_count bigint, paying_customers bigint)
language sql stable as $$
  with m as (
    select date_trunc('month', day)::date as month, sum(gross) gross, sum(refunds) refunds, sum(expense_m) expense_m, sum(completed_cnt) cc
    from rollup_metrics_daily where org_id=p_org and day>=p_from and day<=p_to group by 1
  ),
  c as (
    select month, count(*) pc
    from rollup_customer_month
    where org_id=p_org and month>=date_trunc('month', p_from)::date and month<=p_to and cnt>0
    group by month
  )
  select m.month, coalesce(m.gross,0), coalesce(m.refunds,0), coalesce(m.expense_m,0), coalesce(m.cc,0), coalesce(c.pc,0)
  from m left join c on c.month=m.month order by m.month;
$$;

-- ── 5. Repoint vw_metrics_monthly onto the rollups (was a raw-table scan) ─────
-- Same columns as 091 (gross_revenue/refunds/expense_total/txn_count/paying_customers),
-- so fromViews() and lib/data.ts keep working — but reading the trigger-maintained
-- rollups instead of scanning 13 months of raw transactions with a non-sargable
-- regex. gross/refunds/expense now match the dashboard's PRIMARY (rollup) path
-- exactly, removing a latent view-vs-rollup discrepancy.
create or replace view vw_metrics_monthly as
select
  d.org_id,
  d.month,
  d.gross_revenue,
  d.refunds,
  d.expense_total,
  d.txn_count,
  coalesce(c.paying_customers, 0) as paying_customers
from (
  select org_id,
         date_trunc('month', day)::date as month,
         sum(gross)                as gross_revenue,
         sum(refunds)              as refunds,
         sum(expense_m)            as expense_total,
         -- Preserve the view's existing column TYPES. CREATE OR REPLACE VIEW cannot
         -- change a column's type, and the old column was bigint while sum(bigint)
         -- widens to numeric → cast txn_count back to bigint. paying_customers is
         -- count(*) (already bigint); gross/refunds/expense were numeric before too.
         sum(completed_cnt)::bigint as txn_count
  from rollup_metrics_daily
  where day >= (date_trunc('month', current_date) - interval '13 months')::date
    and day <= current_date
  group by org_id, date_trunc('month', day)
) d
left join (
  select org_id, month, count(*) as paying_customers
  from rollup_customer_month
  where cnt > 0
    and month >= (date_trunc('month', current_date) - interval '13 months')::date
  group by org_id, month
) c on c.org_id = d.org_id and c.month = d.month;

-- ── 6. Backfill / self-heal helpers ─────────────────────────────────────────
-- Bounded per-range rebuild for the initial populate: pass one month-range at a
-- time so each DELETE+INSERT holds a SHORT lock over a SMALL slice (historical
-- months have no concurrent writers at all → contention-free). Run off-hours.
create or replace function rebuild_customer_month(p_org uuid, p_from date default null, p_to date default null)
returns void language plpgsql security definer as $$
begin
  set local statement_timeout = 0;
  delete from rollup_customer_month
   where org_id = p_org
     and (p_from is null or month >= date_trunc('month', p_from)::date)
     and (p_to   is null or month <= date_trunc('month', p_to)::date);
  insert into rollup_customer_month (org_id, month, cust_key, cnt)
    select t.org_id, date_trunc('month', t.transaction_date)::date, _dm_cust_key(t), count(*)
    from transactions t
    where t.org_id = p_org and t.transaction_date is not null and _dm_cust_key(t) is not null
      and (p_from is null or t.transaction_date >= p_from)
      and (p_to   is null or t.transaction_date <= p_to)
    group by t.org_id, date_trunc('month', t.transaction_date)::date, _dm_cust_key(t);
end $$;

-- Keep the global + per-org rebuilds in parity (so the nightly reconcile and any
-- manual rebuild also maintain the month grain, not just the day grain).
create or replace function rebuild_dash_rollups() returns void language plpgsql security definer as $$
begin
  set local statement_timeout = 0;
  truncate rollup_metrics_daily, rollup_customer_day, rollup_customer_month;
  insert into rollup_metrics_daily (org_id, day, gross, completed_amt, refunds, expense_m, outflow_l, completed_cnt, failed_cnt, pending_cnt, refunded_cnt, dispute_cnt, dispute_amt)
    select t.org_id, t.transaction_date,
      sum(_dm_gross(t)), sum(_dm_completed_amt(t)), sum(_dm_refunds(t)), sum(_dm_expense_m(t)), sum(_dm_outflow_l(t)),
      sum(_dm_completed_cnt(t)), sum(_dm_failed_cnt(t)), sum(_dm_pending_cnt(t)), sum(_dm_refunded_cnt(t)), sum(_dm_dispute_cnt(t)), sum(_dm_dispute_amt(t))
    from transactions t where t.transaction_date is not null
    group by t.org_id, t.transaction_date;
  insert into rollup_customer_day (org_id, day, cust_key, cnt)
    select t.org_id, t.transaction_date, _dm_cust_key(t), count(*)
    from transactions t where t.transaction_date is not null and _dm_cust_key(t) is not null
    group by t.org_id, t.transaction_date, _dm_cust_key(t);
  insert into rollup_customer_month (org_id, month, cust_key, cnt)
    select t.org_id, date_trunc('month', t.transaction_date)::date, _dm_cust_key(t), count(*)
    from transactions t where t.transaction_date is not null and _dm_cust_key(t) is not null
    group by t.org_id, date_trunc('month', t.transaction_date)::date, _dm_cust_key(t);
end $$;
alter function rebuild_dash_rollups() set statement_timeout = '600s';

-- ── 7. Grants (match the existing rollup objects) ───────────────────────────
grant select on rollup_customer_month to authenticated, anon, service_role;
grant insert, update, delete on rollup_customer_month to service_role;
grant execute on function _dm_apply_cust_month(uuid, date, text, bigint) to service_role;
grant execute on function rebuild_customer_month(uuid, date, date) to service_role;
grant execute on function dash_metrics_monthly(uuid, date, date) to authenticated, anon, service_role;
grant select on vw_metrics_monthly to authenticated, anon, service_role;
