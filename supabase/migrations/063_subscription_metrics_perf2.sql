-- 063_subscription_metrics_perf2.sql
-- 062 fixed status_now (precomputed last_charge_at) but two RPCs still breached 8s:
--   • subscription_monthly_metrics: the months × subs cross-join re-evaluated the
--     IST timezone casts / interval math per row (CTE was inlined). Fix: materialize
--     the per-sub CTE so all derivation runs ONCE per sub, precompute the month
--     buckets, and let the cross-join do only date comparisons.
--   • subscription_renewals_monthly: no covering index → 227k heap fetches. Fix: a
--     covering partial index (index-only scan).
-- Function results are identical to 062 — this is purely a performance rewrite.

drop index if exists idx_txn_sub_completed;
create index if not exists idx_txn_sub_completed on transactions (org_id, transaction_date)
  include (source, amount_base, amount)
  where subscription_id is not null and type = 'credit' and status = 'completed';

create or replace function subscription_monthly_metrics(p_org uuid, p_from date, p_to date, p_grace_months int default 6)
returns table(
  month date, gateway text,
  new_subs bigint, new_mrr numeric,
  churned_subs bigint, churned_mrr numeric,
  active_eom bigint, mrr_eom numeric,
  pastdue_eom bigint, pastdue_mrr numeric
) language sql stable as $$
  with months as (
    select g.m::date as m, (g.m + interval '1 month' - interval '1 day')::date as eom
    from generate_series(date_trunc('month', p_from)::date, date_trunc('month', p_to)::date, interval '1 month') as g(m)
  ),
  b as materialized (
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
  x as materialized (
    select b.gateway, b.mrr, b.sd, b.status_churned, b.period_end,
           date_trunc('month', b.sd)::date as sd_month,
           (case when b.status_churned then coalesce(b.exit_d, b.period_end) else b.period_end end) as eff_end,
           (b.period_end + make_interval(months => p_grace_months))::date as grace_end,
           date_trunc('month',
             case when b.status_churned then coalesce(b.exit_d, b.period_end)
                  else (b.period_end + make_interval(months => p_grace_months))::date end
           )::date as churn_month
    from b
  )
  select
    mo.m as month, x.gateway,
    count(*) filter (where x.sd_month = mo.m)::bigint as new_subs,
    coalesce(sum(x.mrr) filter (where x.sd_month = mo.m), 0)::numeric as new_mrr,
    count(*) filter (where x.churn_month = mo.m)::bigint as churned_subs,
    coalesce(sum(x.mrr) filter (where x.churn_month = mo.m), 0)::numeric as churned_mrr,
    count(*) filter (where x.sd <= mo.eom and x.eff_end > mo.eom)::bigint as active_eom,
    coalesce(sum(x.mrr) filter (where x.sd <= mo.eom and x.eff_end > mo.eom), 0)::numeric as mrr_eom,
    count(*) filter (where not x.status_churned and x.sd <= mo.eom and x.period_end <= mo.eom and x.grace_end > mo.eom)::bigint as pastdue_eom,
    coalesce(sum(x.mrr) filter (where not x.status_churned and x.sd <= mo.eom and x.period_end <= mo.eom and x.grace_end > mo.eom), 0)::numeric as pastdue_mrr
  from months mo cross join x
  group by mo.m, x.gateway;
$$;

grant execute on function subscription_monthly_metrics(uuid, date, date, int) to authenticated, anon, service_role;
