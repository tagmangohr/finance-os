-- 060_subscription_metrics.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Time-series analytics for the Subscriptions page: month-wise, gateway-wise MRR
-- trend, MRR-movement bridge (new / churned / net), churn %, active trend, NRR,
-- and renewals — all aggregated in Postgres (never by draining rows to JS).
--
-- Historical reconstruction basis (we only have each subscription's CURRENT state,
-- not per-month snapshots):
--   • A subscription's active window = [started_at, ended_at) in IST.
--   • MRR is its current amount_base, monthly-normalized, assumed constant over its
--     life (we have no amount history) → so historical expansion/contraction is not
--     derivable and shows 0; new − churned is the reliable historical bridge. Real
--     expansion/contraction/NRR accrue going forward once monthly snapshots exist.
--   • Never-activated mandates (status 'unknown' / null) are EXCLUDED from active/
--     MRR/new/churned — they're the signup-funnel "pending", reported separately.
--   • Churn = subs whose ended_at falls in the month AND status ∈ (cancelled,expired).
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper: monthly-normalized recurring amount (matches v_subscription_summary).
create or replace function _sub_mrr(p_amount numeric, p_interval text)
returns numeric language sql immutable as $$
  select case lower(coalesce(p_interval, 'month'))
    when 'year' then coalesce(p_amount, 0) / 12.0
    when 'week' then coalesce(p_amount, 0) * 4.33
    when 'day'  then coalesce(p_amount, 0) * 30.0
    else coalesce(p_amount, 0)            -- month (and unknown) treated as monthly
  end;
$$;

-- Indexes to keep the date/status scans cheap.
create index if not exists idx_subs_org_started on subscriptions (org_id, started_at);
create index if not exists idx_subs_org_ended   on subscriptions (org_id, ended_at);
create index if not exists idx_subs_org_status   on subscriptions (org_id, status);

-- Month × gateway subscription metrics over an inclusive month range.
create or replace function subscription_monthly_metrics(p_org uuid, p_from date, p_to date)
returns table(
  month date, gateway text,
  new_subs bigint, new_mrr numeric,
  churned_subs bigint, churned_mrr numeric,
  active_eom bigint, mrr_eom numeric
) language sql stable as $$
  with months as (
    select generate_series(date_trunc('month', p_from)::date,
                           date_trunc('month', p_to)::date,
                           interval '1 month')::date as m
  ),
  s as (
    select gateway::text as gateway,
           (started_at at time zone 'Asia/Kolkata')::date as sd,
           (ended_at   at time zone 'Asia/Kolkata')::date as ed,
           status,
           _sub_mrr(amount_base, billing_interval) as mrr
    from subscriptions
    where org_id = p_org
      and status is not null and status <> 'unknown'  -- exclude never-activated mandates
      and started_at is not null
  )
  select
    mo.m as month, s.gateway,
    count(*) filter (where date_trunc('month', s.sd)::date = mo.m)::bigint as new_subs,
    coalesce(sum(s.mrr) filter (where date_trunc('month', s.sd)::date = mo.m), 0)::numeric as new_mrr,
    count(*) filter (where s.ed is not null and date_trunc('month', s.ed)::date = mo.m and s.status in ('cancelled','expired'))::bigint as churned_subs,
    coalesce(sum(s.mrr) filter (where s.ed is not null and date_trunc('month', s.ed)::date = mo.m and s.status in ('cancelled','expired')), 0)::numeric as churned_mrr,
    count(*) filter (where s.sd <= (mo.m + interval '1 month' - interval '1 day')::date
                       and (s.ed is null or s.ed > (mo.m + interval '1 month' - interval '1 day')::date))::bigint as active_eom,
    coalesce(sum(s.mrr) filter (where s.sd <= (mo.m + interval '1 month' - interval '1 day')::date
                       and (s.ed is null or s.ed > (mo.m + interval '1 month' - interval '1 day')::date)), 0)::numeric as mrr_eom
  from months mo cross join s
  group by mo.m, s.gateway;
$$;

-- Month × source renewal charges (subscription-tagged, completed) from transactions.
create or replace function subscription_renewals_monthly(p_org uuid, p_from date, p_to date)
returns table(month date, source text, renewal_count bigint, renewal_amount numeric)
language sql stable as $$
  select date_trunc('month', t.transaction_date)::date as month,
         t.source::text,
         count(*)::bigint,
         coalesce(sum(coalesce(t.amount_base, t.amount)), 0)::numeric
  from transactions t
  where t.org_id = p_org
    and t.subscription_id is not null
    and t.type = 'credit' and t.status = 'completed'
    and t.transaction_date >= p_from and t.transaction_date <= p_to
  group by 1, 2;
$$;

-- Cohort retention: for each start-month cohort (activated subs), how many remain
-- active k months later (k = 0..p_periods). Powers the retention curve/heatmap.
create or replace function subscription_cohort_retention(p_org uuid, p_from date, p_to date, p_periods int default 12)
returns table(cohort date, k int, cohort_size bigint, retained bigint)
language sql stable as $$
  with s as (
    select date_trunc('month', (started_at at time zone 'Asia/Kolkata')::date)::date as cohort,
           (started_at at time zone 'Asia/Kolkata')::date as sd,
           (ended_at   at time zone 'Asia/Kolkata')::date as ed
    from subscriptions
    where org_id = p_org
      and status is not null and status <> 'unknown'
      and started_at is not null
      and (started_at at time zone 'Asia/Kolkata')::date >= date_trunc('month', p_from)::date
      and (started_at at time zone 'Asia/Kolkata')::date <= p_to
  ),
  ks as (select generate_series(0, p_periods) as k)
  select s.cohort, ks.k,
         count(*)::bigint as cohort_size,
         count(*) filter (
           where s.ed is null
              or s.ed > (s.cohort + (ks.k + 1) * interval '1 month' - interval '1 day')::date
         )::bigint as retained
  from s cross join ks
  group by s.cohort, ks.k;
$$;

grant execute on function _sub_mrr(numeric, text),
                         subscription_monthly_metrics(uuid, date, date),
                         subscription_renewals_monthly(uuid, date, date),
                         subscription_cohort_retention(uuid, date, date, int)
  to authenticated, anon, service_role;
