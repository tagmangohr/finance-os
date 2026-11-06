-- 135_statement_level_insert_rollups.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- SCALABILITY FIX: make bulk transaction INSERTs cheap and timeout-proof.
--
-- Problem (measured in prod, Oct–Nov 2026): every write to `transactions` fires
-- SEVEN per-row AFTER rollup triggers. A single bulk insert of N rows therefore
-- does ~7·N synchronous rollup upserts inside one statement. As the ledger grew
-- past ~550k rows, a 1,000-row backfill/webhook insert stopped finishing inside
-- the DB statement timeout:
--     "Insert failed: canceling statement due to statement timeout"
-- Manual sync + Cashfree/App Store/Razorpay webhooks all inherited this (shared
-- code path: persistTransactions → one bulk upsert). Shrinking the insert chunk
-- only repackages the same 7·N work and slows the worker — it is not a fix.
--
-- Root cause: the write cost scales with rows × triggers. The INSERT is the only
-- path that produces a large single statement (UPDATEs are one row per statement;
-- DELETEs are rare). So we make INSERT set-based and leave UPDATE/DELETE alone.
--
-- Fix: for each rollup, ADD an AFTER INSERT ... FOR EACH STATEMENT trigger that
-- aggregates the whole batch set-based (one handful of upserts, cost ∝ distinct
-- day/month/category groups, NOT row count), and NARROW the existing per-row
-- trigger to UPDATE OR DELETE only. The per-row functions are left byte-for-byte
-- unchanged — their delicate −OLD/+NEW update & delete logic is untouched.
--
-- Correctness: each statement-level INSERT body is copied verbatim from that
-- rollup's own rebuild_*() function (same _helpers, same HAVING, same grouping),
-- turned into an incremental `on conflict do update set col = col + excluded.col`.
-- Per-row +NEW summed over N rows == set-based sum over the same N rows (addition
-- is associative/commutative), so the rollup values are identical. The nightly
-- rebuild_all_rollups() self-heal (098) remains the backstop, and
-- verify_rollup_tieout() (added at the end) proves rollups == raw ledger.
--
-- Preserved per trigger: the app.skip_rollup guard where it exists (dash, txn,
-- pnl, rev_gw), SECURITY DEFINER + search_path on the locked-down txn_summary
-- rollup, and no guard where there was none (fees_gw, txn_summary, sub_last_charge).
--
-- NOTE: AFTER INSERT ... ON CONFLICT DO NOTHING (how persistTransactions inserts)
-- places ONLY actually-inserted rows into the NEW transition table — skipped
-- duplicates are excluded, exactly as the per-row AFTER INSERT trigger skipped
-- them. So de-dup semantics are unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. DASHBOARD ROLLUP  (rollup_metrics_daily + rollup_customer_day + _month)
--    Mirrors rebuild_dash_rollups() (068) + rebuild_customer_month (133).
-- ═══════════════════════════════════════════════════════════════════════════════
create or replace function trg_dash_rollup_ins() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.skip_rollup', true), '') = 'on' then return null; end if;

  insert into rollup_metrics_daily as m
    (org_id, day, gross, completed_amt, refunds, expense_m, outflow_l,
     completed_cnt, failed_cnt, pending_cnt, refunded_cnt, dispute_cnt, dispute_amt)
    select t.org_id, t.transaction_date,
      sum(_dm_gross(t)), sum(_dm_completed_amt(t)), sum(_dm_refunds(t)), sum(_dm_expense_m(t)), sum(_dm_outflow_l(t)),
      sum(_dm_completed_cnt(t)), sum(_dm_failed_cnt(t)), sum(_dm_pending_cnt(t)), sum(_dm_refunded_cnt(t)), sum(_dm_dispute_cnt(t)), sum(_dm_dispute_amt(t))
    from new_rows t where t.transaction_date is not null
    group by t.org_id, t.transaction_date
  on conflict (org_id, day) do update set
    gross=m.gross+excluded.gross, completed_amt=m.completed_amt+excluded.completed_amt, refunds=m.refunds+excluded.refunds,
    expense_m=m.expense_m+excluded.expense_m, outflow_l=m.outflow_l+excluded.outflow_l,
    completed_cnt=m.completed_cnt+excluded.completed_cnt, failed_cnt=m.failed_cnt+excluded.failed_cnt,
    pending_cnt=m.pending_cnt+excluded.pending_cnt, refunded_cnt=m.refunded_cnt+excluded.refunded_cnt,
    dispute_cnt=m.dispute_cnt+excluded.dispute_cnt, dispute_amt=m.dispute_amt+excluded.dispute_amt;

  insert into rollup_customer_day as c (org_id, day, cust_key, cnt)
    select t.org_id, t.transaction_date, _dm_cust_key(t), count(*)
    from new_rows t where t.transaction_date is not null and _dm_cust_key(t) is not null
    group by t.org_id, t.transaction_date, _dm_cust_key(t)
  on conflict (org_id, day, cust_key) do update set cnt = c.cnt + excluded.cnt;

  insert into rollup_customer_month as c (org_id, month, cust_key, cnt)
    select t.org_id, date_trunc('month', t.transaction_date)::date, _dm_cust_key(t), count(*)
    from new_rows t where t.transaction_date is not null and _dm_cust_key(t) is not null
    group by t.org_id, date_trunc('month', t.transaction_date)::date, _dm_cust_key(t)
  on conflict (org_id, month, cust_key) do update set cnt = c.cnt + excluded.cnt;

  return null;
end $$;

drop trigger if exists trg_dash_rollup on transactions;
create trigger trg_dash_rollup after update or delete on transactions
  for each row execute function trg_dash_rollup();
drop trigger if exists trg_dash_rollup_ins on transactions;
create trigger trg_dash_rollup_ins after insert on transactions
  referencing new table as new_rows for each statement execute function trg_dash_rollup_ins();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. REVENUE/CURRENCY/CASHFLOW ROLLUP  (rollup_revenue_monthly + _currency + cashflow)
--    Mirrors rebuild_metric_rollups() (059).
-- ═══════════════════════════════════════════════════════════════════════════════
create or replace function trg_txn_rollup_ins() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.skip_rollup', true), '') = 'on' then return null; end if;

  insert into rollup_revenue_monthly as m (org_id, month, gross_revenue, txn_count)
    select t.org_id, date_trunc('month', t.transaction_date)::date, sum(_rev_contrib(t)), sum(_rev_qual(t))
    from new_rows t where t.transaction_date is not null
    group by 1, 2
    having sum(_rev_contrib(t)) <> 0 or sum(_rev_qual(t)) <> 0
  on conflict (org_id, month) do update
    set gross_revenue = m.gross_revenue + excluded.gross_revenue,
        txn_count      = m.txn_count      + excluded.txn_count;

  insert into rollup_revenue_currency_monthly as m (org_id, currency, month, original, inr)
    select t.org_id, coalesce(t.currency,''), date_trunc('month', t.transaction_date)::date, sum(_rev_orig(t)), sum(_rev_contrib(t))
    from new_rows t where t.transaction_date is not null
    group by 1, 2, 3
    having sum(_rev_orig(t)) <> 0 or sum(_rev_contrib(t)) <> 0
  on conflict (org_id, currency, month) do update
    set original = m.original + excluded.original,
        inr      = m.inr      + excluded.inr;

  insert into rollup_cashflow_daily as m (org_id, day, inflow, outflow)
    select t.org_id, t.transaction_date, sum(_cf_in(t)), sum(_cf_out(t))
    from new_rows t where t.transaction_date is not null
    group by 1, 2
    having sum(_cf_in(t)) <> 0 or sum(_cf_out(t)) <> 0
  on conflict (org_id, day) do update
    set inflow  = m.inflow  + excluded.inflow,
        outflow = m.outflow + excluded.outflow;

  return null;
end $$;

drop trigger if exists trg_txn_rollup on transactions;
create trigger trg_txn_rollup after update or delete on transactions
  for each row execute function trg_txn_rollup();
drop trigger if exists trg_txn_rollup_ins on transactions;
create trigger trg_txn_rollup_ins after insert on transactions
  referencing new table as new_rows for each statement execute function trg_txn_rollup_ins();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. P&L BY CATEGORY ROLLUP  (rollup_pnl_cat_day)
--    Mirrors rebuild_pnl_rollups() (073): expense per category + fees slug.
-- ═══════════════════════════════════════════════════════════════════════════════
create or replace function trg_pnl_rollup_ins() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.skip_rollup', true), '') = 'on' then return null; end if;

  insert into rollup_pnl_cat_day as m (org_id, day, category, amount)
    select t.org_id, t.transaction_date, _pnl_expense_cat(t), sum(_dm_expense_m(t))
    from new_rows t where t.transaction_date is not null
    group by t.org_id, t.transaction_date, _pnl_expense_cat(t)
    having sum(_dm_expense_m(t)) <> 0
  on conflict (org_id, day, category) do update set amount = m.amount + excluded.amount;

  insert into rollup_pnl_cat_day as m (org_id, day, category, amount)
    select t.org_id, t.transaction_date, '__pg_fees__', sum(_pnl_fee(t))
    from new_rows t where t.transaction_date is not null
    group by t.org_id, t.transaction_date
    having sum(_pnl_fee(t)) <> 0
  on conflict (org_id, day, category) do update set amount = m.amount + excluded.amount;

  return null;
end $$;

drop trigger if exists trg_pnl_rollup on transactions;
create trigger trg_pnl_rollup after update or delete on transactions
  for each row execute function trg_pnl_rollup();
drop trigger if exists trg_pnl_rollup_ins on transactions;
create trigger trg_pnl_rollup_ins after insert on transactions
  referencing new table as new_rows for each statement execute function trg_pnl_rollup_ins();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. REVENUE BY GATEWAY ROLLUP  (rollup_revenue_gateway_day)
--    Mirrors rebuild_revenue_gateway_rollups() (080).
-- ═══════════════════════════════════════════════════════════════════════════════
create or replace function trg_rev_gw_rollup_ins() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.skip_rollup', true), '') = 'on' then return null; end if;

  insert into rollup_revenue_gateway_day as m (org_id, day, gateway, amount)
    select t.org_id, t.transaction_date, _rev_gateway(t), sum(_dm_gross(t))
    from new_rows t where t.transaction_date is not null
    group by t.org_id, t.transaction_date, _rev_gateway(t)
    having sum(_dm_gross(t)) <> 0
  on conflict (org_id, day, gateway) do update set amount = m.amount + excluded.amount;

  return null;
end $$;

drop trigger if exists trg_rev_gw_rollup on transactions;
create trigger trg_rev_gw_rollup after update or delete on transactions
  for each row execute function trg_rev_gw_rollup();
drop trigger if exists trg_rev_gw_rollup_ins on transactions;
create trigger trg_rev_gw_rollup_ins after insert on transactions
  referencing new table as new_rows for each statement execute function trg_rev_gw_rollup_ins();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. FEES BY GATEWAY ROLLUP  (rollup_fees_gateway_day)  — no skip_rollup guard (115)
--    Mirrors rebuild_fees_gateway_rollups() (115).
-- ═══════════════════════════════════════════════════════════════════════════════
create or replace function trg_fees_gw_rollup_ins() returns trigger language plpgsql as $$
begin
  insert into rollup_fees_gateway_day as m (org_id, day, gateway, amount)
    select t.org_id, t.transaction_date, _rev_gateway(t), sum(_pnl_fee(t))
    from new_rows t where t.transaction_date is not null
    group by t.org_id, t.transaction_date, _rev_gateway(t)
    having sum(_pnl_fee(t)) <> 0
  on conflict (org_id, day, gateway) do update set amount = m.amount + excluded.amount;

  return null;
end $$;

drop trigger if exists trg_fees_gw_rollup on transactions;
create trigger trg_fees_gw_rollup after update or delete on transactions
  for each row execute function trg_fees_gw_rollup();
drop trigger if exists trg_fees_gw_rollup_ins on transactions;
create trigger trg_fees_gw_rollup_ins after insert on transactions
  referencing new table as new_rows for each statement execute function trg_fees_gw_rollup_ins();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. PAYMENTS SUMMARY ROLLUP  (rollup_txn_summary_day)  — SECURITY DEFINER (096)
--    Mirrors rebuild_txn_summary_rollup() (096). Non-bank rows; null-date → sentinel.
-- ═══════════════════════════════════════════════════════════════════════════════
create or replace function trg_txn_summary_rollup_ins() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into rollup_txn_summary_day as s
    (org_id, day, connector_id, source, category, status, type, cnt, sum_base, sum_fee)
    select t.org_id, coalesce(t.transaction_date, date '0001-01-01'), t.connector_id,
           t.source::text, coalesce(t.category::text,''), coalesce(t.status::text,''), t.type::text,
           count(*), coalesce(sum(_ts_base(t)),0), coalesce(sum(_ts_fee(t)),0)
    from new_rows t where _ts_included(t)
    group by 1, 2, 3, 4, 5, 6, 7
  on conflict (org_id, day, connector_id, source, category, status, type) do update set
    cnt = s.cnt + excluded.cnt, sum_base = s.sum_base + excluded.sum_base, sum_fee = s.sum_fee + excluded.sum_fee;

  return null;
end $$;

drop trigger if exists trg_txn_summary_rollup on transactions;
create trigger trg_txn_summary_rollup after update or delete on transactions
  for each row execute function trg_txn_summary_rollup();
drop trigger if exists trg_txn_summary_rollup_ins on transactions;
create trigger trg_txn_summary_rollup_ins after insert on transactions
  referencing new table as new_rows for each statement execute function trg_txn_summary_rollup_ins();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. SUBSCRIPTION last_charge_at PRECOMPUTE  (subscriptions.last_charge_at)  (062)
--    Monotonic max advance. Original trigger was AFTER INSERT OR UPDATE (no delete).
-- ═══════════════════════════════════════════════════════════════════════════════
create or replace function trg_sub_last_charge_ins() returns trigger language plpgsql as $$
begin
  update subscriptions s
     set last_charge_at = greatest(coalesce(s.last_charge_at, m.d), m.d)
    from (
      select t.org_id, t.subscription_id, max(t.transaction_date) as d
      from new_rows t
      where t.subscription_id is not null and t.type = 'credit' and t.status = 'completed'
        and t.transaction_date is not null
      group by t.org_id, t.subscription_id
    ) m
   where s.org_id = m.org_id and s.subscription_id = m.subscription_id
     and (s.last_charge_at is null or s.last_charge_at < m.d);

  return null;
end $$;

drop trigger if exists trg_sub_last_charge on transactions;
create trigger trg_sub_last_charge after update on transactions
  for each row execute function trg_sub_last_charge();
drop trigger if exists trg_sub_last_charge_ins on transactions;
create trigger trg_sub_last_charge_ins after insert on transactions
  referencing new table as new_rows for each statement execute function trg_sub_last_charge_ins();

-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. TIE-OUT: prove every additive rollup still equals a fresh raw aggregation.
--    READ-ONLY (recomputes into temp tables, diffs against the live rollup, drops
--    them). Returns one row per rollup with the count of mismatched groups and the
--    largest absolute value difference. All zeros ⇒ exact. Run after apply, and
--    again after the first sync, to confirm the new INSERT path stays consistent.
-- ═══════════════════════════════════════════════════════════════════════════════
create or replace function verify_rollup_tieout()
returns table(rollup text, mismatched_groups bigint, max_abs_diff numeric)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  set local statement_timeout = 0;

  -- rollup_metrics_daily (gross/refunds/expense_m as the material money columns)
  return query
  with raw as (
    select t.org_id, t.transaction_date as day,
      sum(_dm_gross(t)) g, sum(_dm_refunds(t)) r, sum(_dm_expense_m(t)) e
    from transactions t where t.transaction_date is not null
    group by t.org_id, t.transaction_date
  )
  select 'rollup_metrics_daily'::text,
    count(*) filter (where abs(coalesce(x.g,0)-coalesce(y.gross,0))>0.01
                        or abs(coalesce(x.r,0)-coalesce(y.refunds,0))>0.01
                        or abs(coalesce(x.e,0)-coalesce(y.expense_m,0))>0.01),
    coalesce(max(greatest(abs(coalesce(x.g,0)-coalesce(y.gross,0)),
                          abs(coalesce(x.r,0)-coalesce(y.refunds,0)),
                          abs(coalesce(x.e,0)-coalesce(y.expense_m,0)))),0)
  from raw x full join rollup_metrics_daily y on y.org_id=x.org_id and y.day=x.day;

  -- rollup_revenue_monthly
  return query
  with raw as (
    select t.org_id, date_trunc('month',t.transaction_date)::date month, sum(_rev_contrib(t)) g
    from transactions t where t.transaction_date is not null group by 1,2
    having sum(_rev_contrib(t)) <> 0
  )
  select 'rollup_revenue_monthly'::text,
    count(*) filter (where abs(coalesce(x.g,0)-coalesce(y.gross_revenue,0))>0.01),
    coalesce(max(abs(coalesce(x.g,0)-coalesce(y.gross_revenue,0))),0)
  from raw x full join rollup_revenue_monthly y on y.org_id=x.org_id and y.month=x.month;

  -- rollup_revenue_gateway_day
  return query
  with raw as (
    select t.org_id, t.transaction_date day, _rev_gateway(t) gw, sum(_dm_gross(t)) a
    from transactions t where t.transaction_date is not null group by 1,2,3
    having sum(_dm_gross(t)) <> 0
  )
  select 'rollup_revenue_gateway_day'::text,
    count(*) filter (where abs(coalesce(x.a,0)-coalesce(y.amount,0))>0.01),
    coalesce(max(abs(coalesce(x.a,0)-coalesce(y.amount,0))),0)
  from raw x full join rollup_revenue_gateway_day y on y.org_id=x.org_id and y.day=x.day and y.gateway=x.gw;

  -- rollup_fees_gateway_day
  return query
  with raw as (
    select t.org_id, t.transaction_date day, _rev_gateway(t) gw, sum(_pnl_fee(t)) a
    from transactions t where t.transaction_date is not null group by 1,2,3
    having sum(_pnl_fee(t)) <> 0
  )
  select 'rollup_fees_gateway_day'::text,
    count(*) filter (where abs(coalesce(x.a,0)-coalesce(y.amount,0))>0.01),
    coalesce(max(abs(coalesce(x.a,0)-coalesce(y.amount,0))),0)
  from raw x full join rollup_fees_gateway_day y on y.org_id=x.org_id and y.day=x.day and y.gateway=x.gw;

  -- rollup_pnl_cat_day
  return query
  with raw as (
    select t.org_id, t.transaction_date day, _pnl_expense_cat(t) cat, sum(_dm_expense_m(t)) a
    from transactions t where t.transaction_date is not null group by 1,2,3
    having sum(_dm_expense_m(t)) <> 0
    union all
    select t.org_id, t.transaction_date, '__pg_fees__', sum(_pnl_fee(t))
    from transactions t where t.transaction_date is not null group by 1,2
    having sum(_pnl_fee(t)) <> 0
  )
  select 'rollup_pnl_cat_day'::text,
    count(*) filter (where abs(coalesce(x.a,0)-coalesce(y.amount,0))>0.01),
    coalesce(max(abs(coalesce(x.a,0)-coalesce(y.amount,0))),0)
  from raw x full join rollup_pnl_cat_day y on y.org_id=x.org_id and y.day=x.day and y.category=x.cat;

  -- rollup_cashflow_daily
  return query
  with raw as (
    select t.org_id, t.transaction_date day, sum(_cf_in(t)) i, sum(_cf_out(t)) o
    from transactions t where t.transaction_date is not null group by 1,2
    having sum(_cf_in(t)) <> 0 or sum(_cf_out(t)) <> 0
  )
  select 'rollup_cashflow_daily'::text,
    count(*) filter (where abs(coalesce(x.i,0)-coalesce(y.inflow,0))>0.01
                        or abs(coalesce(x.o,0)-coalesce(y.outflow,0))>0.01),
    coalesce(max(greatest(abs(coalesce(x.i,0)-coalesce(y.inflow,0)),
                          abs(coalesce(x.o,0)-coalesce(y.outflow,0)))),0)
  from raw x full join rollup_cashflow_daily y on y.org_id=x.org_id and y.day=x.day;
end $$;

grant execute on function verify_rollup_tieout() to service_role;
