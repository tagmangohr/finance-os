-- 122_dash_metrics_range.sql
-- Range (from/to) variants of the Dashboard activity RPCs, so the Dashboard's
-- period selector can re-scope the payment-health + customer metrics to any date
-- range (matching the range filter used on the other tabs). The existing
-- dash_metrics_health / dash_metrics_customers (068) only take "last N days from
-- today"; these take explicit from/to for exact scoping. Same rollup tables, same
-- columns — only the WHERE window differs. The app falls back to the p_days
-- variants until this is applied.

create or replace function dash_metrics_health_range(p_org uuid, p_from date, p_to date)
returns table(completed_count bigint, failed_count bigint, pending_count bigint, refunded_count bigint,
  net_completed_volume numeric, gross_volume numeric, refund_amount numeric, dispute_count bigint, dispute_amount numeric)
language sql stable as $$
  select coalesce(sum(completed_cnt),0), coalesce(sum(failed_cnt),0), coalesce(sum(pending_cnt),0), coalesce(sum(refunded_cnt),0),
    coalesce(sum(completed_amt),0), coalesce(sum(gross),0), coalesce(sum(refunds),0), coalesce(sum(dispute_cnt),0), coalesce(sum(dispute_amt),0)
  from rollup_metrics_daily
  where org_id = p_org and day >= p_from and day <= p_to;
$$;

create or replace function dash_metrics_customers_range(p_org uuid, p_from date, p_to date)
returns table(paying_customers bigint, net_revenue numeric, txn_count bigint)
language sql stable as $$
  select
    (select count(distinct cust_key) from rollup_customer_day
       where org_id = p_org and cnt > 0 and day >= p_from and day <= p_to),
    coalesce((select sum(completed_amt) from rollup_metrics_daily
       where org_id = p_org and day >= p_from and day <= p_to), 0),
    coalesce((select sum(completed_cnt) from rollup_metrics_daily
       where org_id = p_org and day >= p_from and day <= p_to), 0);
$$;

grant execute on function dash_metrics_health_range(uuid, date, date),
                         dash_metrics_customers_range(uuid, date, date)
  to authenticated, anon, service_role;
