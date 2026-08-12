-- 068_dashboard_metric_rollups.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- The dashboard's getMetricData reads 4 PLAIN views (vw_metrics_monthly / _health /
-- _customers / _totals) that scan the whole transactions table live (5.8s / 3.5s /
-- 1.7s / 3.3s at 429k rows). On the real page they breach the statement timeout and
-- the monthly data silently comes back empty → every revenue card shows ₹0. At 2M
-- rows they're hopeless.
--
-- Fix (extends the 059 trigger-rollup pattern to the whole dashboard): precompute
-- everything into trigger-maintained rollups so nothing scans raw rows — instant at
-- any volume.
--   • rollup_metrics_daily   — all ADDITIVE metrics at org×day grain (monthly = sum
--     days→months, health = sum last 90 days, totals = sum all days).
--   • rollup_customer_day     — per (org, day, customer) refcount for EXACT distinct
--     paying-customer counts (monthly + rolling 90 days) without scanning raw rows.
-- Semantics reproduce migration 039's views exactly (bank-ledger firewall, refund/
-- dispute splits, settlement/payout exclusion). 4 read RPCs return the same shapes
-- the views did, so getMetricData barely changes.
-- ─────────────────────────────────────────────────────────────────────────────

-- Row is counted by the dashboard only if it isn't a settlement/payout transfer.
create or replace function _dm_excluded(r transactions) returns boolean language sql immutable as $$
  select coalesce(r.category,'') = 'settlement' or coalesce(r.source,'') ~* '(settlement|payout)';
$$;
create or replace function _dm_base(r transactions) returns numeric language sql immutable as $$
  select coalesce(r.amount_base, r.amount, 0);
$$;

-- Additive component contributions (match vw_metrics_* filters in 039).
create or replace function _dm_gross(r transactions) returns numeric language sql immutable as $$        -- credit·payments·(completed|refunded)
  select case when _dm_excluded(r) then 0 when r.type='credit' and r.ledger='payments' and r.status in ('completed','refunded') then _dm_base(r) else 0 end; $$;
create or replace function _dm_completed_amt(r transactions) returns numeric language sql immutable as $$ -- credit·payments·completed
  select case when _dm_excluded(r) then 0 when r.type='credit' and r.ledger='payments' and r.status='completed' then _dm_base(r) else 0 end; $$;
create or replace function _dm_refunds(r transactions) returns numeric language sql immutable as $$       -- (debit·payments·refund)+(credit·payments·refunded)
  select case when _dm_excluded(r) then 0 when r.ledger='payments' and ((r.type='debit' and r.category='refund') or (r.type='credit' and r.status='refunded')) then _dm_base(r) else 0 end; $$;
create or replace function _dm_expense_m(r transactions) returns numeric language sql immutable as $$     -- monthly expense_total
  select case when _dm_excluded(r) then 0 when r.type='debit' and ((r.ledger='bank' and r.pnl_treatment='expense') or (r.ledger='payments' and coalesce(r.category,'') not in ('refund','dispute','settlement'))) then _dm_base(r) else 0 end; $$;
create or replace function _dm_outflow_l(r transactions) returns numeric language sql immutable as $$     -- lifetime_outflow (payments side keeps refunds)
  select case when _dm_excluded(r) then 0 when r.type='debit' and ((r.ledger='bank' and r.pnl_treatment='expense') or (r.ledger='payments' and coalesce(r.category,'') not in ('dispute','settlement'))) then _dm_base(r) else 0 end; $$;
create or replace function _dm_completed_cnt(r transactions) returns bigint language sql immutable as $$
  select case when _dm_excluded(r) then 0 when r.type='credit' and r.ledger='payments' and r.status='completed' then 1 else 0 end; $$;
create or replace function _dm_failed_cnt(r transactions) returns bigint language sql immutable as $$
  select case when _dm_excluded(r) then 0 when r.type='credit' and r.ledger='payments' and r.status='failed' then 1 else 0 end; $$;
create or replace function _dm_pending_cnt(r transactions) returns bigint language sql immutable as $$
  select case when _dm_excluded(r) then 0 when r.type='credit' and r.ledger='payments' and r.status='pending' then 1 else 0 end; $$;
create or replace function _dm_refunded_cnt(r transactions) returns bigint language sql immutable as $$
  select case when _dm_excluded(r) then 0 when r.type='credit' and r.ledger='payments' and r.status='refunded' then 1 else 0 end; $$;
create or replace function _dm_dispute_cnt(r transactions) returns bigint language sql immutable as $$
  select case when _dm_excluded(r) then 0 when r.ledger='payments' and r.category='dispute' then 1 else 0 end; $$;
create or replace function _dm_dispute_amt(r transactions) returns numeric language sql immutable as $$
  select case when _dm_excluded(r) then 0 when r.ledger='payments' and r.category='dispute' then _dm_base(r) else 0 end; $$;

-- Distinct-customer key: a customer counts on a day iff it's a completed PG payment
-- with a non-empty counterparty name (matches the views' distinct filter).
create or replace function _dm_cust_key(r transactions) returns text language sql immutable as $$
  select case when _dm_excluded(r) or r.type<>'credit' or r.ledger<>'payments' or r.status<>'completed'
              or coalesce(r.counterparty_name,'')='' then null else lower(r.counterparty_name) end; $$;

-- ── Rollup tables ───────────────────────────────────────────────────────────
create table if not exists rollup_metrics_daily (
  org_id uuid not null, day date not null,
  gross numeric not null default 0, completed_amt numeric not null default 0, refunds numeric not null default 0,
  expense_m numeric not null default 0, outflow_l numeric not null default 0,
  completed_cnt bigint not null default 0, failed_cnt bigint not null default 0, pending_cnt bigint not null default 0,
  refunded_cnt bigint not null default 0, dispute_cnt bigint not null default 0, dispute_amt numeric not null default 0,
  primary key (org_id, day)
);
create table if not exists rollup_customer_day (
  org_id uuid not null, day date not null, cust_key text not null, cnt bigint not null default 0,
  primary key (org_id, day, cust_key)
);
create index if not exists idx_rollup_cust_day on rollup_customer_day (org_id, day) where cnt > 0;

-- ── Appliers (idempotent upserts) ───────────────────────────────────────────
create or replace function _dm_apply_daily(
  p_org uuid, p_day date,
  d_gross numeric, d_camt numeric, d_ref numeric, d_expm numeric, d_outl numeric,
  d_cc bigint, d_fc bigint, d_pc bigint, d_rc bigint, d_dc bigint, d_da numeric
) returns void language plpgsql as $$
begin
  if d_gross=0 and d_camt=0 and d_ref=0 and d_expm=0 and d_outl=0 and d_cc=0 and d_fc=0 and d_pc=0 and d_rc=0 and d_dc=0 and d_da=0 then return; end if;
  insert into rollup_metrics_daily as m (org_id, day, gross, completed_amt, refunds, expense_m, outflow_l, completed_cnt, failed_cnt, pending_cnt, refunded_cnt, dispute_cnt, dispute_amt)
  values (p_org, p_day, d_gross, d_camt, d_ref, d_expm, d_outl, d_cc, d_fc, d_pc, d_rc, d_dc, d_da)
  on conflict (org_id, day) do update set
    gross=m.gross+excluded.gross, completed_amt=m.completed_amt+excluded.completed_amt, refunds=m.refunds+excluded.refunds,
    expense_m=m.expense_m+excluded.expense_m, outflow_l=m.outflow_l+excluded.outflow_l,
    completed_cnt=m.completed_cnt+excluded.completed_cnt, failed_cnt=m.failed_cnt+excluded.failed_cnt,
    pending_cnt=m.pending_cnt+excluded.pending_cnt, refunded_cnt=m.refunded_cnt+excluded.refunded_cnt,
    dispute_cnt=m.dispute_cnt+excluded.dispute_cnt, dispute_amt=m.dispute_amt+excluded.dispute_amt;
end $$;
create or replace function _dm_apply_cust(p_org uuid, p_day date, p_key text, p_delta bigint) returns void language plpgsql as $$
begin
  if p_key is null or p_delta=0 then return; end if;
  insert into rollup_customer_day as c (org_id, day, cust_key, cnt) values (p_org, p_day, p_key, p_delta)
  on conflict (org_id, day, cust_key) do update set cnt = c.cnt + excluded.cnt;
end $$;

-- ── Trigger: apply -OLD then +NEW ───────────────────────────────────────────
create or replace function trg_dash_rollup() returns trigger language plpgsql as $$
begin
  if TG_OP in ('UPDATE','DELETE') and OLD.transaction_date is not null then
    perform _dm_apply_daily(OLD.org_id, OLD.transaction_date,
      -_dm_gross(OLD), -_dm_completed_amt(OLD), -_dm_refunds(OLD), -_dm_expense_m(OLD), -_dm_outflow_l(OLD),
      -_dm_completed_cnt(OLD), -_dm_failed_cnt(OLD), -_dm_pending_cnt(OLD), -_dm_refunded_cnt(OLD), -_dm_dispute_cnt(OLD), -_dm_dispute_amt(OLD));
    perform _dm_apply_cust(OLD.org_id, OLD.transaction_date, _dm_cust_key(OLD), -1);
  end if;
  if TG_OP in ('INSERT','UPDATE') and NEW.transaction_date is not null then
    perform _dm_apply_daily(NEW.org_id, NEW.transaction_date,
      _dm_gross(NEW), _dm_completed_amt(NEW), _dm_refunds(NEW), _dm_expense_m(NEW), _dm_outflow_l(NEW),
      _dm_completed_cnt(NEW), _dm_failed_cnt(NEW), _dm_pending_cnt(NEW), _dm_refunded_cnt(NEW), _dm_dispute_cnt(NEW), _dm_dispute_amt(NEW));
    perform _dm_apply_cust(NEW.org_id, NEW.transaction_date, _dm_cust_key(NEW), 1);
  end if;
  return null;
end $$;
drop trigger if exists trg_dash_rollup on transactions;
create trigger trg_dash_rollup after insert or update or delete on transactions for each row execute function trg_dash_rollup();

-- ── Full rebuild (initial populate + safety net) ────────────────────────────
create or replace function rebuild_dash_rollups() returns void language plpgsql security definer as $$
begin
  set local statement_timeout = 0;
  truncate rollup_metrics_daily, rollup_customer_day;
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
end $$;

-- ── Read RPCs (return the exact shapes the 4 views did) ─────────────────────
create or replace function dash_metrics_monthly(p_org uuid, p_from date, p_to date)
returns table(month date, gross_revenue numeric, refunds numeric, expense_total numeric, txn_count bigint, paying_customers bigint)
language sql stable as $$
  with m as (
    select date_trunc('month', day)::date as month, sum(gross) gross, sum(refunds) refunds, sum(expense_m) expense_m, sum(completed_cnt) cc
    from rollup_metrics_daily where org_id=p_org and day>=p_from and day<=p_to group by 1
  ),
  c as (
    select date_trunc('month', day)::date as month, count(distinct cust_key) pc
    from rollup_customer_day where org_id=p_org and day>=p_from and day<=p_to and cnt>0 group by 1
  )
  select m.month, coalesce(m.gross,0), coalesce(m.refunds,0), coalesce(m.expense_m,0), coalesce(m.cc,0), coalesce(c.pc,0)
  from m left join c on c.month=m.month order by m.month;
$$;

create or replace function dash_metrics_health(p_org uuid, p_days int default 90)
returns table(completed_count bigint, failed_count bigint, pending_count bigint, refunded_count bigint,
  net_completed_volume numeric, gross_volume numeric, refund_amount numeric, dispute_count bigint, dispute_amount numeric)
language sql stable as $$
  select coalesce(sum(completed_cnt),0), coalesce(sum(failed_cnt),0), coalesce(sum(pending_cnt),0), coalesce(sum(refunded_cnt),0),
    coalesce(sum(completed_amt),0), coalesce(sum(gross),0), coalesce(sum(refunds),0), coalesce(sum(dispute_cnt),0), coalesce(sum(dispute_amt),0)
  from rollup_metrics_daily
  where org_id=p_org and day >= (now() at time zone 'Asia/Kolkata')::date - p_days and day <= (now() at time zone 'Asia/Kolkata')::date;
$$;

create or replace function dash_metrics_customers(p_org uuid, p_days int default 90)
returns table(paying_customers bigint, net_revenue numeric, txn_count bigint)
language sql stable as $$
  select
    (select count(distinct cust_key) from rollup_customer_day
       where org_id=p_org and cnt>0 and day >= (now() at time zone 'Asia/Kolkata')::date - p_days and day <= (now() at time zone 'Asia/Kolkata')::date),
    coalesce((select sum(completed_amt) from rollup_metrics_daily
       where org_id=p_org and day >= (now() at time zone 'Asia/Kolkata')::date - p_days and day <= (now() at time zone 'Asia/Kolkata')::date),0),
    coalesce((select sum(completed_cnt) from rollup_metrics_daily
       where org_id=p_org and day >= (now() at time zone 'Asia/Kolkata')::date - p_days and day <= (now() at time zone 'Asia/Kolkata')::date),0);
$$;

create or replace function dash_metrics_totals(p_org uuid)
returns table(lifetime_inflow numeric, lifetime_outflow numeric)
language sql stable as $$
  select coalesce(sum(completed_amt),0), coalesce(sum(outflow_l),0) from rollup_metrics_daily where org_id=p_org;
$$;

select rebuild_dash_rollups();

grant select on rollup_metrics_daily, rollup_customer_day to authenticated, anon, service_role;
grant insert, update, delete on rollup_metrics_daily, rollup_customer_day to service_role;
grant execute on function rebuild_dash_rollups(),
  dash_metrics_monthly(uuid, date, date), dash_metrics_health(uuid, int),
  dash_metrics_customers(uuid, int), dash_metrics_totals(uuid) to authenticated, anon, service_role;
