-- 062_subscription_metrics_perf.sql
-- The v2 RPCs (061) recomputed each subscription's last successful charge by
-- aggregating the 227k tagged transactions on EVERY call → renewals timed out and
-- status_now/monthly ran ~5s (full range would breach the 8s cap). Fix: precompute
-- subscriptions.last_charge_at (column + one-time backfill + a lightweight trigger
-- so it stays current in real time), add supporting indexes, and repoint the RPCs
-- to read the column instead of scanning transactions. Also drops the stray 4-arg
-- cohort function that 061 left as an overload (caused "could not choose candidate").

-- ── Fix the cohort overload (060 left a 4-arg version; 061 added a 5-arg one) ──
drop function if exists subscription_cohort_retention(uuid, date, date, int);

-- ── Precomputed last successful charge per subscription ─────────────────────
alter table subscriptions add column if not exists last_charge_at date;
create index if not exists idx_subs_org_subid on subscriptions (org_id, subscription_id);
create index if not exists idx_txn_sub_completed on transactions (org_id, transaction_date)
  where subscription_id is not null and type = 'credit' and status = 'completed';
create index if not exists idx_txn_sub_lastcharge on transactions (subscription_id, transaction_date)
  where subscription_id is not null and type = 'credit' and status = 'completed';

do $$ begin
  perform set_config('statement_timeout', '0', true);
  update subscriptions s
     set last_charge_at = lc.d
    from (
      select org_id, subscription_id, max(transaction_date) as d
      from transactions
      where subscription_id is not null and type = 'credit' and status = 'completed'
      group by 1, 2
    ) lc
   where s.org_id = lc.org_id and s.subscription_id = lc.subscription_id
     and s.last_charge_at is distinct from lc.d;
end $$;

-- Keep it current: any completed subscription charge advances the sub's last_charge_at.
create or replace function trg_sub_last_charge() returns trigger language plpgsql as $$
begin
  if NEW.subscription_id is not null and NEW.type = 'credit' and NEW.status = 'completed' then
    update subscriptions
       set last_charge_at = greatest(coalesce(last_charge_at, NEW.transaction_date), NEW.transaction_date)
     where org_id = NEW.org_id and subscription_id = NEW.subscription_id
       and (last_charge_at is null or last_charge_at < NEW.transaction_date);
  end if;
  return null;
end $$;
drop trigger if exists trg_sub_last_charge on transactions;
create trigger trg_sub_last_charge after insert or update on transactions
  for each row execute function trg_sub_last_charge();

-- ── Repoint the RPCs to the precomputed column (logic identical to 061) ─────
create or replace function subscription_status_now(p_org uuid, p_grace_months int default 6)
returns table(segment text, gateway text, subs bigint, mrr numeric) language sql stable as $$
  with b as (
    select s.gateway::text as gateway,
           _sub_mrr(s.amount_base, s.billing_interval) as mrr,
           (s.status in ('cancelled','expired','paused')) as status_churned,
           coalesce(
             (s.next_charge_at      at time zone 'Asia/Kolkata')::date,
             (s.current_period_end  at time zone 'Asia/Kolkata')::date,
             (s.last_charge_at + _sub_step(s.billing_interval))::date,
             ((s.started_at at time zone 'Asia/Kolkata')::date + _sub_step(s.billing_interval))::date
           ) as period_end
    from subscriptions s
    where s.org_id = p_org and s.started_at is not null
      and s.status is not null and s.status <> 'unknown'
  ), today as (select (now() at time zone 'Asia/Kolkata')::date as d)
  select
    case when b.status_churned then 'churned'
         when b.period_end >= t.d then 'active'
         when b.period_end >= (t.d - make_interval(months => p_grace_months))::date then 'past_due'
         else 'churned' end as segment,
    b.gateway, count(*)::bigint, coalesce(sum(b.mrr), 0)::numeric
  from b cross join today t
  group by 1, 2;
$$;

drop function if exists subscription_monthly_metrics(uuid, date, date, int);
create or replace function subscription_monthly_metrics(p_org uuid, p_from date, p_to date, p_grace_months int default 6)
returns table(
  month date, gateway text,
  new_subs bigint, new_mrr numeric,
  churned_subs bigint, churned_mrr numeric,
  active_eom bigint, mrr_eom numeric,
  pastdue_eom bigint, pastdue_mrr numeric
) language sql stable as $$
  with months as (
    select generate_series(date_trunc('month', p_from)::date, date_trunc('month', p_to)::date, interval '1 month')::date as m
  ),
  b as (
    select s.gateway::text as gateway,
           _sub_mrr(s.amount_base, s.billing_interval) as mrr,
           (s.started_at at time zone 'Asia/Kolkata')::date as sd,
           (s.status in ('cancelled','expired','paused')) as status_churned,
           coalesce((s.ended_at at time zone 'Asia/Kolkata')::date,
                    (s.cancel_requested_at at time zone 'Asia/Kolkata')::date) as exit_d,
           coalesce(
             (s.next_charge_at      at time zone 'Asia/Kolkata')::date,
             (s.current_period_end  at time zone 'Asia/Kolkata')::date,
             (s.last_charge_at + _sub_step(s.billing_interval))::date,
             ((s.started_at at time zone 'Asia/Kolkata')::date + _sub_step(s.billing_interval))::date
           ) as period_end
    from subscriptions s
    where s.org_id = p_org and s.started_at is not null
      and s.status is not null and s.status <> 'unknown'
  ),
  x as (
    select b.*,
           case when b.status_churned then coalesce(b.exit_d, b.period_end) else b.period_end end as eff_end,
           (b.period_end + make_interval(months => p_grace_months))::date as grace_end
    from b
  )
  select
    mo.m as month, x.gateway,
    count(*) filter (where date_trunc('month', x.sd)::date = mo.m)::bigint as new_subs,
    coalesce(sum(x.mrr) filter (where date_trunc('month', x.sd)::date = mo.m), 0)::numeric as new_mrr,
    count(*) filter (where (x.status_churned and x.exit_d is not null and date_trunc('month', x.exit_d)::date = mo.m)
                        or (not x.status_churned and date_trunc('month', x.grace_end)::date = mo.m))::bigint as churned_subs,
    coalesce(sum(x.mrr) filter (where (x.status_churned and x.exit_d is not null and date_trunc('month', x.exit_d)::date = mo.m)
                        or (not x.status_churned and date_trunc('month', x.grace_end)::date = mo.m)), 0)::numeric as churned_mrr,
    count(*) filter (where x.sd <= (mo.m + interval '1 month' - interval '1 day')::date
                        and x.eff_end > (mo.m + interval '1 month' - interval '1 day')::date)::bigint as active_eom,
    coalesce(sum(x.mrr) filter (where x.sd <= (mo.m + interval '1 month' - interval '1 day')::date
                        and x.eff_end > (mo.m + interval '1 month' - interval '1 day')::date), 0)::numeric as mrr_eom,
    count(*) filter (where not x.status_churned
                        and x.sd <= (mo.m + interval '1 month' - interval '1 day')::date
                        and x.period_end <= (mo.m + interval '1 month' - interval '1 day')::date
                        and x.grace_end > (mo.m + interval '1 month' - interval '1 day')::date)::bigint as pastdue_eom,
    coalesce(sum(x.mrr) filter (where not x.status_churned
                        and x.sd <= (mo.m + interval '1 month' - interval '1 day')::date
                        and x.period_end <= (mo.m + interval '1 month' - interval '1 day')::date
                        and x.grace_end > (mo.m + interval '1 month' - interval '1 day')::date), 0)::numeric as pastdue_mrr
  from months mo cross join x
  group by mo.m, x.gateway;
$$;

create or replace function subscription_cohort_retention(p_org uuid, p_from date, p_to date, p_periods int default 12, p_grace_months int default 6)
returns table(cohort date, k int, cohort_size bigint, retained bigint) language sql stable as $$
  with b as (
    select date_trunc('month', (s.started_at at time zone 'Asia/Kolkata')::date)::date as cohort,
           case when s.status in ('cancelled','expired','paused')
                then coalesce((s.ended_at at time zone 'Asia/Kolkata')::date, (s.cancel_requested_at at time zone 'Asia/Kolkata')::date,
                              (s.last_charge_at + _sub_step(s.billing_interval))::date)
                else coalesce((s.next_charge_at at time zone 'Asia/Kolkata')::date, (s.current_period_end at time zone 'Asia/Kolkata')::date,
                              (s.last_charge_at + _sub_step(s.billing_interval))::date,
                              ((s.started_at at time zone 'Asia/Kolkata')::date + _sub_step(s.billing_interval))::date)
           end as eff_end
    from subscriptions s
    where s.org_id = p_org and s.started_at is not null and s.status is not null and s.status <> 'unknown'
      and (s.started_at at time zone 'Asia/Kolkata')::date >= date_trunc('month', p_from)::date
      and (s.started_at at time zone 'Asia/Kolkata')::date <= p_to
  ),
  ks as (select generate_series(0, p_periods) as k)
  select b.cohort, ks.k, count(*)::bigint as cohort_size,
         count(*) filter (where b.eff_end > (b.cohort + (ks.k + 1) * interval '1 month' - interval '1 day')::date)::bigint as retained
  from b cross join ks
  group by b.cohort, ks.k;
$$;

grant execute on function subscription_status_now(uuid, int),
                         subscription_monthly_metrics(uuid, date, date, int),
                         subscription_cohort_retention(uuid, date, date, int, int)
  to authenticated, anon, service_role;
