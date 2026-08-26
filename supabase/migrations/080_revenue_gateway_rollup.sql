-- 080_revenue_gateway_rollup.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Revenue-by-gateway over an arbitrary range, FAST.
--
-- The Analytics page wants gross revenue split by payment gateway (Cashfree /
-- Stripe / Razorpay / Apple) across a whole FY. The only existing path is
-- pnl_drill_groups, which SCANS the raw ~400k-row transactions table — fine for a
-- single-month drill cell, but it hits the 8s statement timeout over a full year
-- (and gets worse as volume grows). So add a trigger-maintained rollup at
-- org × day × gateway grain, exactly like the dashboard (068) and P&L (073)
-- rollups. Revenue semantics REUSE _dm_gross (068) so the split sums EXACTLY to
-- dash_metrics_monthly.gross_revenue — no drift, and settlements/payouts excluded.
-- ─────────────────────────────────────────────────────────────────────────────

-- Gateway stem for a row. Only meaningful for revenue rows (else '' → skipped by
-- the applier's 0-guard since _dm_gross is 0 there anyway). Apple's source has no
-- underscore variants, so keep it whole; everything else is the stem before '_'
-- (stripe / stripe_refund → 'stripe'); _dm_gross already zeroes non-revenue rows.
create or replace function _rev_gateway(r transactions) returns text language sql immutable as $$
  select case
    when r.source is null then 'other'
    when r.source ~~ 'app_store%' then 'app_store'
    else split_part(r.source::text, '_', 1)
  end;
$$;

-- ── Rollup table (org × day × gateway) ──────────────────────────────────────
create table if not exists rollup_revenue_gateway_day (
  org_id  uuid    not null,
  day     date    not null,
  gateway text    not null,
  amount  numeric not null default 0,
  primary key (org_id, day, gateway)
);
create index if not exists idx_rollup_rev_gw_day on rollup_revenue_gateway_day (org_id, day);

-- ── Applier (idempotent add) ────────────────────────────────────────────────
create or replace function _rev_gw_apply(p_org uuid, p_day date, p_gw text, p_delta numeric) returns void language plpgsql as $$
begin
  if p_delta = 0 or p_gw is null or p_gw = '' then return; end if;
  insert into rollup_revenue_gateway_day as m (org_id, day, gateway, amount)
  values (p_org, p_day, p_gw, p_delta)
  on conflict (org_id, day, gateway) do update set amount = m.amount + excluded.amount;
end $$;

-- ── Trigger: apply -OLD then +NEW (gross-revenue contribution per gateway) ───
create or replace function trg_rev_gw_rollup() returns trigger language plpgsql as $$
begin
  if TG_OP in ('UPDATE','DELETE') and OLD.transaction_date is not null then
    perform _rev_gw_apply(OLD.org_id, OLD.transaction_date, _rev_gateway(OLD), -_dm_gross(OLD));
  end if;
  if TG_OP in ('INSERT','UPDATE') and NEW.transaction_date is not null then
    perform _rev_gw_apply(NEW.org_id, NEW.transaction_date, _rev_gateway(NEW),  _dm_gross(NEW));
  end if;
  return null;
end $$;
drop trigger if exists trg_rev_gw_rollup on transactions;
create trigger trg_rev_gw_rollup after insert or update or delete on transactions for each row execute function trg_rev_gw_rollup();

-- ── Full rebuild (initial populate + safety net) ────────────────────────────
create or replace function rebuild_revenue_gateway_rollups() returns void language plpgsql security definer as $$
begin
  set local statement_timeout = 0;
  truncate rollup_revenue_gateway_day;
  insert into rollup_revenue_gateway_day (org_id, day, gateway, amount)
    select t.org_id, t.transaction_date, _rev_gateway(t), sum(_dm_gross(t))
    from transactions t
    where t.transaction_date is not null
    group by t.org_id, t.transaction_date, _rev_gateway(t)
    having sum(_dm_gross(t)) <> 0;
end $$;

-- ── Read RPC: gateway × amount over a range ─────────────────────────────────
create or replace function revenue_by_gateway(p_org uuid, p_from date, p_to date)
returns table(gateway text, amount numeric)
language sql stable as $$
  select gateway, sum(amount) as amount
  from rollup_revenue_gateway_day
  where org_id = p_org and day >= p_from and day <= p_to
  group by gateway
  having sum(amount) <> 0
  order by sum(amount) desc;
$$;

select rebuild_revenue_gateway_rollups();

grant select on rollup_revenue_gateway_day to authenticated, anon, service_role;
grant insert, update, delete on rollup_revenue_gateway_day to service_role;
grant execute on function rebuild_revenue_gateway_rollups(), revenue_by_gateway(uuid, date, date) to authenticated, anon, service_role;
