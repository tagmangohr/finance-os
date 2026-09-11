-- 104_security_lockdown_part2.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Finishes the C1/H3 lockdown that 103 started. 103 put RLS on the rollup TABLES,
-- but two gaps remained (proven by an anon-key probe):
--   • the vw_* VIEWS still ran with the view-owner's rights (a plain view bypasses
--     the underlying table RLS), so anon could still read them; and
--   • some RPCs are SECURITY DEFINER — `transactions_summary_groups` returned REAL
--     grouped payment rows to the public anon key, bypassing the table RLS entirely.
--
-- FIX: make the data-reading views and RPCs run with the CALLER's rights
-- (security_invoker), so they inherit the table RLS from 103:
--   • anon / authenticated  → RLS applies → 0 rows.
--   • service_role (the app) → bypasses RLS → full data, unchanged.
-- Verified first: every reader of these objects is the service role; there are no
-- browser reads and no authenticated-session RPC calls, so nothing app-facing breaks.
-- REVOKE was unreliable in this Supabase project (roles retain access via defaults),
-- which is why we switch the execution context instead of relying on grants.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Views → security_invoker (skip any that don't exist) ──
do $$
declare v text;
begin
  foreach v in array array[
    'vw_metrics_monthly','vw_metrics_payment_health','vw_metrics_customers','vw_metrics_totals',
    'vw_bank_monthly','vw_bank_category','vw_revenue_by_currency',
    'vw_cashflow_daily','vw_runway_inputs','vw_category_breakdown'
  ] loop
    if exists (select 1 from pg_views where schemaname = 'public' and viewname = v) then
      execute format('alter view public.%I set (security_invoker = on)', v);
    end if;
  end loop;
end $$;

-- ── 2. Data-reading RPCs → security invoker (all overloads, by name) ──
-- These only ever run server-side via the service role (which bypasses RLS), so
-- invoker execution is transparent for the app and closes the leak for anon.
-- Rebuild/refresh functions are intentionally NOT touched (service/cron only; they
-- don't leak reads and may need owner rights to write the rollups).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'dash_metrics_monthly','dash_metrics_health','dash_metrics_customers','dash_metrics_totals',
        'pnl_monthly','pnl_drill_groups','revenue_by_gateway',
        'metrics_monthly_range','revenue_by_currency_range','cashflow_daily_range',
        'subscription_monthly_metrics','subscription_list',
        'sales_dimensions','sales_overview_agg','bank_overview_agg',
        'transactions_summary_groups'
      ])
  loop
    execute format('alter function %s security invoker', r.sig);
  end loop;
end $$;
