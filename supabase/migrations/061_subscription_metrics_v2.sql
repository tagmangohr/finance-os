-- 061_subscription_metrics_v2.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Corrected subscription model. The v1 (060) reconstruction treated a sub as active
-- over [started_at, ended_at); but ended_at is unset for past-due subs, so they
-- counted as active forever (reconstructed active 34.6k vs true 17k).
--
-- New model (per product spec) — a DERIVED period-end drives everything:
--   period_end = gateway's next_charge_at / current_period_end when present,
--                else last successful charge + one billing interval,
--                else started_at + one billing interval.
--   • Active           = not cancelled/expired/paused AND period_end >= today.
--   • Past-due (revivable) = not cancelled/expired/paused AND period_end < today
--                        but within the grace window (default 6 months). NOT churned
--                        — sales can win these back; tracked with recoverable MRR.
--   • Churned (out)    = cancelled / expired / paused, OR lapsed beyond the grace
--                        window (period_end + grace < today).
--   Total customers = active + past-due.
--   Historical active-in-month uses [started, effective_end) where effective_end =
--   exit date (status-churned) or derived period_end (live) — no "active forever".
-- ─────────────────────────────────────────────────────────────────────────────

-- Billing-interval → period length.
create or replace function _sub_step(p_interval text) returns interval language sql immutable as $$
  select case lower(coalesce(p_interval, 'month'))
    when 'year' then interval '1 year'
    when 'week' then interval '1 week'
    when 'day'  then interval '1 day'
    else interval '1 month'
  end;
$$;

-- Current-state segmentation (as of today, IST): active / past_due / churned, per gateway.
create or replace function subscription_status_now(p_org uuid, p_grace_months int default 6)
returns table(segment text, gateway text, subs bigint, mrr numeric) language sql stable as $$
  with lc as (
    select subscription_id, max(transaction_date) as last_charge
    from transactions
    where org_id = p_org and subscription_id is not null and type = 'credit' and status = 'completed'
    group by subscription_id
  ),
  b as (
    select s.gateway::text as gateway,
           _sub_mrr(s.amount_base, s.billing_interval) as mrr,
           (s.status in ('cancelled','expired','paused')) as status_churned,
           coalesce(
             (s.next_charge_at      at time zone 'Asia/Kolkata')::date,
             (s.current_period_end  at time zone 'Asia/Kolkata')::date,
             (lc.last_charge + _sub_step(s.billing_interval))::date,
             ((s.started_at at time zone 'Asia/Kolkata')::date + _sub_step(s.billing_interval))::date
           ) as period_end
    from subscriptions s
    left join lc on lc.subscription_id = s.subscription_id
    where s.org_id = p_org and s.started_at is not null
      and s.status is not null and s.status <> 'unknown'
  ),
  today as (select (now() at time zone 'Asia/Kolkata')::date as d)
  select
    case
      when b.status_churned then 'churned'
      when b.period_end >= t.d then 'active'
      when b.period_end >= (t.d - make_interval(months => p_grace_months))::date then 'past_due'
      else 'churned'
    end as segment,
    b.gateway, count(*)::bigint, coalesce(sum(b.mrr), 0)::numeric
  from b cross join today t
  group by 1, 2;
$$;

-- Month × gateway trend. active/past-due are end-of-month states; new/churned are
-- flows within the month. mrr_eom = active MRR; pastdue_mrr = recoverable MRR.
drop function if exists subscription_monthly_metrics(uuid, date, date);
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
  lc as (
    select subscription_id, max(transaction_date) as last_charge
    from transactions
    where org_id = p_org and subscription_id is not null and type = 'credit' and status = 'completed'
    group by subscription_id
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
             (lc.last_charge + _sub_step(s.billing_interval))::date,
             ((s.started_at at time zone 'Asia/Kolkata')::date + _sub_step(s.billing_interval))::date
           ) as period_end
    from subscriptions s
    left join lc on lc.subscription_id = s.subscription_id
    where s.org_id = p_org and s.started_at is not null
      and s.status is not null and s.status <> 'unknown'
  ),
  x as (
    select b.*,
           case when b.status_churned then coalesce(b.exit_d, b.period_end) else b.period_end end as eff_end,
           -- date a live sub is deemed churned if it never recovers (period_end + grace)
           (b.period_end + make_interval(months => p_grace_months))::date as grace_end
    from b
  )
  select
    mo.m as month, x.gateway,
    count(*) filter (where date_trunc('month', x.sd)::date = mo.m)::bigint as new_subs,
    coalesce(sum(x.mrr) filter (where date_trunc('month', x.sd)::date = mo.m), 0)::numeric as new_mrr,
    -- churn flow: status-churn exit in month, or grace-expiry in month for live lapsed subs
    count(*) filter (where (x.status_churned and x.exit_d is not null and date_trunc('month', x.exit_d)::date = mo.m)
                        or (not x.status_churned and date_trunc('month', x.grace_end)::date = mo.m))::bigint as churned_subs,
    coalesce(sum(x.mrr) filter (where (x.status_churned and x.exit_d is not null and date_trunc('month', x.exit_d)::date = mo.m)
                        or (not x.status_churned and date_trunc('month', x.grace_end)::date = mo.m)), 0)::numeric as churned_mrr,
    -- active at end of month: started on/before eom and still within its effective window
    count(*) filter (where x.sd <= (mo.m + interval '1 month' - interval '1 day')::date
                        and x.eff_end > (mo.m + interval '1 month' - interval '1 day')::date)::bigint as active_eom,
    coalesce(sum(x.mrr) filter (where x.sd <= (mo.m + interval '1 month' - interval '1 day')::date
                        and x.eff_end > (mo.m + interval '1 month' - interval '1 day')::date), 0)::numeric as mrr_eom,
    -- past-due (revivable) at end of month: live, lapsed, still within grace
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

-- Renewals (unchanged from 060).
create or replace function subscription_renewals_monthly(p_org uuid, p_from date, p_to date)
returns table(month date, source text, renewal_count bigint, renewal_amount numeric)
language sql stable as $$
  select date_trunc('month', t.transaction_date)::date as month, t.source::text,
         count(*)::bigint, coalesce(sum(coalesce(t.amount_base, t.amount)), 0)::numeric
  from transactions t
  where t.org_id = p_org and t.subscription_id is not null
    and t.type = 'credit' and t.status = 'completed'
    and t.transaction_date >= p_from and t.transaction_date <= p_to
  group by 1, 2;
$$;

-- Cohort retention using the derived effective-end (fixes the "retained forever" bug).
create or replace function subscription_cohort_retention(p_org uuid, p_from date, p_to date, p_periods int default 12, p_grace_months int default 6)
returns table(cohort date, k int, cohort_size bigint, retained bigint) language sql stable as $$
  with lc as (
    select subscription_id, max(transaction_date) as last_charge
    from transactions where org_id = p_org and subscription_id is not null and type = 'credit' and status = 'completed'
    group by subscription_id
  ),
  b as (
    select date_trunc('month', (s.started_at at time zone 'Asia/Kolkata')::date)::date as cohort,
           (s.started_at at time zone 'Asia/Kolkata')::date as sd,
           case when s.status in ('cancelled','expired','paused')
                then coalesce((s.ended_at at time zone 'Asia/Kolkata')::date, (s.cancel_requested_at at time zone 'Asia/Kolkata')::date,
                              (lc.last_charge + _sub_step(s.billing_interval))::date)
                else coalesce((s.next_charge_at at time zone 'Asia/Kolkata')::date, (s.current_period_end at time zone 'Asia/Kolkata')::date,
                              (lc.last_charge + _sub_step(s.billing_interval))::date,
                              ((s.started_at at time zone 'Asia/Kolkata')::date + _sub_step(s.billing_interval))::date)
           end as eff_end
    from subscriptions s left join lc on lc.subscription_id = s.subscription_id
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

grant execute on function _sub_step(text),
                         subscription_status_now(uuid, int),
                         subscription_monthly_metrics(uuid, date, date, int),
                         subscription_renewals_monthly(uuid, date, date),
                         subscription_cohort_retention(uuid, date, date, int, int)
  to authenticated, anon, service_role;
