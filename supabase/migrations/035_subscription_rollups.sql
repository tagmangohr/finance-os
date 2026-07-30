-- ============================================================
-- FILE: 035_subscription_rollups.sql
-- Rollup views for the Subscriptions dashboard. We aggregate MRR/active/plan metrics
-- in Postgres (not by summing rows in the app) — there are 23k+ subscription rows,
-- well past the client row cap, and per our metrics lesson aggregation belongs in the DB.
--
-- Money note: MRR is derived from `amount_base` (INR-normalized recurring rate),
-- normalized to a MONTHLY figure by billing interval. This is a RATE (run-rate), not
-- summed transaction revenue — no double counting with `transactions`.
-- Read by the admin-gated server dashboard via the service client.
-- ============================================================

-- Per org × gateway × status: subscription count + monthly-normalized MRR base.
-- security_invoker=true → the view respects the underlying tables' RLS (service-role
-- only), so it can NEVER leak subscription PII to the anon/authenticated API. The
-- admin-gated server dashboard reads it via the service client (which bypasses RLS).
create or replace view public.v_subscription_summary with (security_invoker = true) as
select
  s.org_id,
  s.gateway,
  s.status,
  count(*)::bigint as subscriptions,
  coalesce(sum(
    case s.billing_interval
      when 'year'  then s.amount_base / 12.0
      when 'week'  then s.amount_base * 4.33
      when 'day'   then s.amount_base * 30.0
      else s.amount_base            -- month (and unknown) treated as monthly
    end
  ), 0) as mrr_base
from public.subscriptions s
group by s.org_id, s.gateway, s.status;

-- Per org × gateway × plan (ACTIVE only): active subs + MRR, for "revenue by plan".
create or replace view public.v_subscription_plan_summary with (security_invoker = true) as
select
  s.org_id,
  s.gateway,
  coalesce(s.plan_name, s.plan_id, '(unnamed plan)') as plan,
  s.currency,
  count(*)::bigint as active_subscriptions,
  coalesce(sum(
    case s.billing_interval
      when 'year'  then s.amount_base / 12.0
      when 'week'  then s.amount_base * 4.33
      when 'day'   then s.amount_base * 30.0
      else s.amount_base
    end
  ), 0) as mrr_base
from public.subscriptions s
where s.status = 'active'
group by s.org_id, s.gateway, coalesce(s.plan_name, s.plan_id, '(unnamed plan)'), s.currency;

comment on view public.v_subscription_summary is
  'Dashboard rollup: subscription count + monthly-normalized MRR (from amount_base) per org/gateway/status. MRR is a run-rate, never summed with transactions.';
comment on view public.v_subscription_plan_summary is
  'Dashboard rollup: active subscriptions + MRR per org/gateway/plan (revenue-by-plan report).';
