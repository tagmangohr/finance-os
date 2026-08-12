-- 067_subscription_list_daterange.sql
-- Add an optional start-date range (p_from/p_to, on started_at in IST) to
-- subscription_list so the Customers section can be time-filtered like other pages.
-- Drops the prior 7-arg signature first so there's no overload ambiguity.
drop function if exists subscription_list(uuid, text, int, text, text, int, int);
create or replace function subscription_list(
  p_org uuid, p_segment text default 'active', p_grace_months int default 6,
  p_search text default null, p_sort text default 'mrr', p_limit int default 50, p_offset int default 0,
  p_from date default null, p_to date default null
) returns table(
  gateway text, subscription_id text, customer_name text, customer_email text, customer_phone text,
  plan_name text, plan_amount numeric, currency text, amount_base numeric, billing_interval text,
  status text, native_status text, started_at timestamptz, current_period_end timestamptz,
  next_charge_at timestamptz, last_charge_at date, ended_at timestamptz,
  period_end date, mrr numeric, segment text, total_count bigint
) language sql stable as $$
  with b as (
    select s.gateway::text as gateway, s.subscription_id, s.customer_name, s.customer_email, s.customer_phone,
           s.plan_name, s.plan_amount, s.currency, s.amount_base, s.billing_interval,
           s.status::text as status, s.native_status, s.started_at, s.current_period_end,
           s.next_charge_at, s.last_charge_at, s.ended_at,
           (s.started_at at time zone 'Asia/Kolkata')::date as sd,
           _sub_mrr(s.amount_base, s.billing_interval) as mrr,
           (case when s.status is null or s.status = 'unknown' then 'pending'
                 when s.status in ('cancelled','expired','paused') then 'churned'
                 else 'live' end) as base_seg,
           coalesce(
             (s.next_charge_at      at time zone 'Asia/Kolkata')::date,
             (s.current_period_end  at time zone 'Asia/Kolkata')::date,
             (s.last_charge_at + _sub_step(s.billing_interval))::date,
             ((s.started_at at time zone 'Asia/Kolkata')::date + _sub_step(s.billing_interval))::date
           ) as p_end
    from subscriptions s
    where s.org_id = p_org and s.started_at is not null
  ),
  t as (select (now() at time zone 'Asia/Kolkata')::date as d),
  seg as (
    select b.*,
           case when b.base_seg = 'pending' then 'pending'
                when b.base_seg = 'churned' then 'churned'
                when b.p_end >= t.d then 'active'
                when b.p_end >= (t.d - make_interval(months => p_grace_months))::date then 'past_due'
                else 'churned' end as segment_
    from b cross join t
  ),
  filtered as (
    select * from seg
    where segment_ = p_segment
      and (p_from is null or sd >= p_from)
      and (p_to   is null or sd <= p_to)
      and (p_search is null or p_search = '' or (
        coalesce(customer_name,'')   ilike '%' || p_search || '%' or
        coalesce(customer_email,'')  ilike '%' || p_search || '%' or
        coalesce(customer_phone,'')  ilike '%' || p_search || '%' or
        coalesce(plan_name,'')       ilike '%' || p_search || '%' or
        coalesce(subscription_id,'') ilike '%' || p_search || '%'))
  )
  select gateway, subscription_id, customer_name, customer_email, customer_phone,
         plan_name, plan_amount, currency, amount_base, billing_interval,
         status, native_status, started_at, current_period_end, next_charge_at, last_charge_at, ended_at,
         p_end as period_end, mrr, segment_ as segment, count(*) over() as total_count
  from filtered
  order by
    (case when p_sort = 'lapsed' then p_end end) asc nulls last,
    (case when p_sort = 'recent' then started_at end) desc nulls last,
    amount_base desc nulls last,
    subscription_id asc
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0);
$$;
grant execute on function subscription_list(uuid, text, int, text, text, int, int, date, date) to authenticated, anon, service_role;
