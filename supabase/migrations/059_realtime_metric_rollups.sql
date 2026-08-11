-- 059_realtime_metric_rollups.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Make the dashboard metric rollups ALWAYS-CURRENT, with NO cron / manual refresh.
--
-- Problem: migration 058 precomputed monthly revenue into MATERIALIZED VIEWS to
-- beat the 8s statement timeout at 400k+ rows. But a materialized view is only as
-- fresh as its last REFRESH — so a backfill/webhook write didn't show on the
-- dashboard until refresh_metric_rollups() ran (that's why July read ₹1.25Cr while
-- the live table held ₹2.20Cr).
--
-- Fix: replace the materialized views with ordinary ROLLUP TABLES that are kept
-- exactly in sync by a row-level trigger on `transactions`. Every insert / update /
-- delete applies its signed delta to only the affected (org, month|day|currency)
-- buckets — so ANY write (webhook, sync, or a manual SQL backfill) updates the
-- metrics instantly, at the database layer, with zero cron dependence. Reads stay
-- sub-second (a handful of precomputed rows), forever.
--
-- Canonical revenue is unchanged and defined ONCE (the _rev_/_cf_ helpers below),
-- shared by the trigger and the full-rebuild, so the two can never drift:
--   credit + payments ledger + terminal status, excluding settlement/payout.
-- Cashflow mirrors cashflow_daily_range's classify() (bank income/expense + PG).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Rollup tables (grain matches each consumer) ─────────────────────────────
create table if not exists rollup_revenue_monthly (
  org_id        uuid    not null,
  month         date    not null,
  gross_revenue numeric not null default 0,
  txn_count     bigint  not null default 0,
  primary key (org_id, month)
);

create table if not exists rollup_revenue_currency_monthly (
  org_id   uuid    not null,
  currency text    not null,
  month    date    not null,
  original numeric not null default 0,
  inr      numeric not null default 0,
  primary key (org_id, currency, month)
);
create index if not exists idx_rollup_rev_cur_org_month on rollup_revenue_currency_monthly (org_id, month);

create table if not exists rollup_cashflow_daily (
  org_id  uuid    not null,
  day     date    not null,
  inflow  numeric not null default 0,
  outflow numeric not null default 0,
  primary key (org_id, day)
);

-- ── Canonical contribution helpers (single source of truth) ─────────────────
-- SQL + immutable so the planner INLINES them (no per-row call overhead in the
-- full rebuild) and the trigger and rebuild use the identical definition.

-- Gross revenue amount (INR) a row contributes; 0 if it isn't revenue.
create or replace function _rev_contrib(r transactions) returns numeric language sql immutable as $$
  select case
    when r.type = 'credit' and r.ledger = 'payments'
     and r.status in ('completed','refunded')
     and coalesce(r.category,'') <> 'settlement'
     and coalesce(r.source,'') !~ '_(payout|settlement)$'
    then coalesce(r.amount_base, r.amount) else 0 end;
$$;

-- 1 if the row is a revenue payment (for txn_count), else 0.
create or replace function _rev_qual(r transactions) returns bigint language sql immutable as $$
  select case
    when r.type = 'credit' and r.ledger = 'payments'
     and r.status in ('completed','refunded')
     and coalesce(r.category,'') <> 'settlement'
     and coalesce(r.source,'') !~ '_(payout|settlement)$'
    then 1 else 0 end;
$$;

-- Original-currency revenue amount (for the currency split); 0 if not revenue.
create or replace function _rev_orig(r transactions) returns numeric language sql immutable as $$
  select case
    when r.type = 'credit' and r.ledger = 'payments'
     and r.status in ('completed','refunded')
     and coalesce(r.category,'') <> 'settlement'
     and coalesce(r.source,'') !~ '_(payout|settlement)$'
    then r.amount else 0 end;
$$;

-- Cashflow inflow (INR) a row contributes; mirrors cashflow_daily_range.
create or replace function _cf_in(r transactions) returns numeric language sql immutable as $$
  select case
    when r.status in ('completed','refunded')
     and coalesce(r.source,'') !~ '_(payout|settlement)$'
     and ( (r.ledger = 'bank'     and r.pnl_treatment in ('income','expense') and r.type = 'credit')
        or (r.ledger = 'payments' and r.type = 'credit' and coalesce(r.category,'') <> 'settlement') )
    then coalesce(r.amount_base, r.amount) else 0 end;
$$;

-- Cashflow outflow (INR) a row contributes; mirrors cashflow_daily_range.
create or replace function _cf_out(r transactions) returns numeric language sql immutable as $$
  select case
    when r.status in ('completed','refunded')
     and coalesce(r.source,'') !~ '_(payout|settlement)$'
     and ( (r.ledger = 'bank'     and r.pnl_treatment in ('income','expense') and r.type = 'debit')
        or (r.ledger = 'payments' and r.type = 'debit') )
    then coalesce(r.amount_base, r.amount) else 0 end;
$$;

-- ── Bucket appliers (idempotent upserts; no-op on a zero delta) ──────────────
create or replace function _rollup_apply_rev_month(p_org uuid, p_month date, p_amt numeric, p_cnt bigint)
returns void language plpgsql as $$
begin
  if p_amt = 0 and p_cnt = 0 then return; end if;
  insert into rollup_revenue_monthly (org_id, month, gross_revenue, txn_count)
  values (p_org, p_month, p_amt, p_cnt)
  on conflict (org_id, month) do update
    set gross_revenue = rollup_revenue_monthly.gross_revenue + excluded.gross_revenue,
        txn_count      = rollup_revenue_monthly.txn_count      + excluded.txn_count;
end $$;

create or replace function _rollup_apply_rev_cur(p_org uuid, p_cur text, p_month date, p_orig numeric, p_inr numeric)
returns void language plpgsql as $$
begin
  if p_orig = 0 and p_inr = 0 then return; end if;
  insert into rollup_revenue_currency_monthly (org_id, currency, month, original, inr)
  values (p_org, p_cur, p_month, p_orig, p_inr)
  on conflict (org_id, currency, month) do update
    set original = rollup_revenue_currency_monthly.original + excluded.original,
        inr      = rollup_revenue_currency_monthly.inr      + excluded.inr;
end $$;

create or replace function _rollup_apply_cf_day(p_org uuid, p_day date, p_in numeric, p_out numeric)
returns void language plpgsql as $$
begin
  if p_in = 0 and p_out = 0 then return; end if;
  insert into rollup_cashflow_daily (org_id, day, inflow, outflow)
  values (p_org, p_day, p_in, p_out)
  on conflict (org_id, day) do update
    set inflow  = rollup_cashflow_daily.inflow  + excluded.inflow,
        outflow = rollup_cashflow_daily.outflow + excluded.outflow;
end $$;

-- ── The trigger: apply -OLD then +NEW to every affected bucket ──────────────
-- Row-level so OLD/NEW are always scalars (no transition-table op juggling). OLD
-- and NEW may land in different month/day/currency buckets (e.g. a corrected date
-- or a re-FX'd amount), so each is applied to its own bucket independently.
create or replace function trg_txn_rollup() returns trigger language plpgsql as $$
begin
  if TG_OP in ('UPDATE','DELETE') and OLD.transaction_date is not null then
    perform _rollup_apply_rev_month(OLD.org_id, date_trunc('month', OLD.transaction_date)::date, -_rev_contrib(OLD), -_rev_qual(OLD));
    perform _rollup_apply_rev_cur(OLD.org_id, coalesce(OLD.currency,''), date_trunc('month', OLD.transaction_date)::date, -_rev_orig(OLD), -_rev_contrib(OLD));
    perform _rollup_apply_cf_day(OLD.org_id, OLD.transaction_date, -_cf_in(OLD), -_cf_out(OLD));
  end if;
  if TG_OP in ('INSERT','UPDATE') and NEW.transaction_date is not null then
    perform _rollup_apply_rev_month(NEW.org_id, date_trunc('month', NEW.transaction_date)::date, _rev_contrib(NEW), _rev_qual(NEW));
    perform _rollup_apply_rev_cur(NEW.org_id, coalesce(NEW.currency,''), date_trunc('month', NEW.transaction_date)::date, _rev_orig(NEW), _rev_contrib(NEW));
    perform _rollup_apply_cf_day(NEW.org_id, NEW.transaction_date, _cf_in(NEW), _cf_out(NEW));
  end if;
  return null;
end $$;

drop trigger if exists trg_txn_rollup on transactions;
create trigger trg_txn_rollup
  after insert or update or delete on transactions
  for each row execute function trg_txn_rollup();

-- ── Full rebuild (initial populate + safety net) ────────────────────────────
-- Recomputes all three rollups from scratch. Runs administratively so it lifts the
-- statement timeout (aggregating the whole table is the very thing the 8s cap kills
-- for the app). Idempotent. refresh_metric_rollups() is kept as an alias so any
-- existing caller/cron still works — but with the trigger it is no longer required.
create or replace function rebuild_metric_rollups() returns void language plpgsql security definer as $$
begin
  set local statement_timeout = 0;
  truncate rollup_revenue_monthly, rollup_revenue_currency_monthly, rollup_cashflow_daily;

  insert into rollup_revenue_monthly (org_id, month, gross_revenue, txn_count)
    select t.org_id, date_trunc('month', t.transaction_date)::date, sum(_rev_contrib(t)), sum(_rev_qual(t))
    from transactions t where t.transaction_date is not null
    group by 1, 2
    having sum(_rev_contrib(t)) <> 0 or sum(_rev_qual(t)) <> 0;

  insert into rollup_revenue_currency_monthly (org_id, currency, month, original, inr)
    select t.org_id, coalesce(t.currency,''), date_trunc('month', t.transaction_date)::date, sum(_rev_orig(t)), sum(_rev_contrib(t))
    from transactions t where t.transaction_date is not null
    group by 1, 2, 3
    having sum(_rev_orig(t)) <> 0 or sum(_rev_contrib(t)) <> 0;

  insert into rollup_cashflow_daily (org_id, day, inflow, outflow)
    select t.org_id, t.transaction_date, sum(_cf_in(t)), sum(_cf_out(t))
    from transactions t where t.transaction_date is not null
    group by 1, 2
    having sum(_cf_in(t)) <> 0 or sum(_cf_out(t)) <> 0;
end $$;

create or replace function refresh_metric_rollups() returns void language plpgsql security definer as $$
begin
  perform rebuild_metric_rollups();
end $$;

-- ── Repoint the ranged RPCs to read the always-fresh rollup tables ──────────
create or replace function metrics_monthly_range(p_org uuid, p_from date, p_to date)
returns table(month date, gross_revenue numeric) language sql stable as $$
  select r.month, r.gross_revenue
  from rollup_revenue_monthly r
  where r.org_id = p_org
    and r.month >= date_trunc('month', p_from)::date
    and r.month <= p_to
  order by r.month;
$$;

create or replace function revenue_by_currency_range(p_org uuid, p_from date, p_to date)
returns table(currency text, original numeric, inr numeric) language sql stable as $$
  select c.currency, coalesce(sum(c.original),0) as original, coalesce(sum(c.inr),0) as inr
  from rollup_revenue_currency_monthly c
  where c.org_id = p_org
    and c.month >= date_trunc('month', p_from)::date
    and c.month <= p_to
  group by c.currency;
$$;

create or replace function cashflow_daily_range(p_org uuid, p_from date, p_to date)
returns table(date date, inflow numeric, outflow numeric) language sql stable as $$
  select d.day as date, d.inflow, d.outflow
  from rollup_cashflow_daily d
  where d.org_id = p_org
    and d.day >= p_from
    and d.day <= p_to
  order by d.day;
$$;

-- ── Populate now, then retire the materialized views ────────────────────────
select rebuild_metric_rollups();

drop materialized view if exists mv_metrics_monthly;
drop materialized view if exists mv_rev_currency_monthly;

-- ── Grants (match the retired MVs; service_role also writes via the trigger) ─
grant select on rollup_revenue_monthly, rollup_revenue_currency_monthly, rollup_cashflow_daily
  to authenticated, anon, service_role;
grant insert, update, delete on rollup_revenue_monthly, rollup_revenue_currency_monthly, rollup_cashflow_daily
  to service_role;
grant execute on function rebuild_metric_rollups(), refresh_metric_rollups() to service_role;
grant execute on function metrics_monthly_range(uuid, date, date),
                         revenue_by_currency_range(uuid, date, date),
                         cashflow_daily_range(uuid, date, date)
  to authenticated, anon, service_role;
