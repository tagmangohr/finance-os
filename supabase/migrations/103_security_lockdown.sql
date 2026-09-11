-- 103_security_lockdown.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Closes the cross-org data exposure found in the full review (C1 + H3).
--
-- C1: rollup TABLES, matviews, VIEWS and a set of RPCs were GRANTed to the public
--     `anon` role (and `authenticated`) with NO RLS, so anyone holding the public
--     anon key could read every org's revenue / P&L / cashflow / customer names
--     straight off PostgREST — no login required.
-- H3: `transactions` had a member-read RLS policy that let ANY active member read
--     the entire payments book via their own JWT, bypassing the app's page-access
--     and search-only limits.
--
-- AUDIT (done before writing this): every server reader of these objects AND of
-- `transactions` uses the SERVICE role (createServiceClient). There are NO browser
-- reads and NO user-session reads of this data anywhere in app/ or lib/, and no
-- client-side `.rpc()` calls. service_role bypasses RLS and keeps its own grants,
-- so revoking anon/authenticated and dropping the transactions member-read policy
-- does not affect any working path.
--
-- DELIBERATELY NOT TOUCHED: `connectors_member_reads`. The connectors PAGE reads
-- `connectors` via the USER session (app/dashboard/connectors/page.tsx), so dropping
-- it would blank that page for members. Its rows are org-scoped (auth_is_active_member)
-- and secrets are encrypted (enc:v1:), so the residual risk is low — handled separately.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1a. Leaking TABLES: revoke public read + enable RLS (service_role bypasses) ──
revoke select on
  rollup_metrics_daily, rollup_customer_day,
  rollup_revenue_monthly, rollup_revenue_currency_monthly, rollup_cashflow_daily,
  rollup_pnl_cat_day, rollup_revenue_gateway_day, forecast_growth
  from anon, authenticated;

alter table rollup_metrics_daily            enable row level security;
alter table rollup_customer_day             enable row level security;
alter table rollup_revenue_monthly          enable row level security;
alter table rollup_revenue_currency_monthly enable row level security;
alter table rollup_cashflow_daily           enable row level security;
alter table rollup_pnl_cat_day              enable row level security;
alter table rollup_revenue_gateway_day      enable row level security;
alter table forecast_growth                 enable row level security;

-- ── 1b. Matviews (RLS not supported) + VIEWS: revoke public read ──
revoke select on mv_metrics_monthly, mv_rev_currency_monthly from anon, authenticated;
revoke select on
  vw_metrics_monthly, vw_metrics_payment_health, vw_metrics_customers, vw_metrics_totals,
  vw_revenue_by_currency, vw_cashflow_daily, vw_runway_inputs,
  vw_bank_monthly, vw_bank_category, vw_category_breakdown
  from anon, authenticated;

-- ── 1c. Leaking RPCs: revoke EXECUTE from anon + authenticated (by name, all
--        overloads). service_role retains its own grant, so every app call (all
--        server-side/service) keeps working; crons/rebuilds are service-only too. ──
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        -- per-org data readers (the actual leak surface)
        'dash_metrics_monthly','dash_metrics_health','dash_metrics_customers','dash_metrics_totals',
        'pnl_monthly','pnl_drill_groups','revenue_by_gateway',
        'metrics_monthly_range','revenue_by_currency_range','cashflow_daily_range',
        'subscription_monthly_metrics','subscription_list',
        'sales_dimensions','sales_overview_agg','bank_overview_agg',
        'transactions_summary_groups',
        -- rebuild/refresh helpers (service/cron only; defensive)
        'rebuild_dash_rollups','rebuild_pnl_rollups','rebuild_revenue_gateway_rollups',
        'rebuild_metric_rollups','refresh_metric_rollups','rebuild_all_rollups',
        'rebuild_org_rollups','rebuild_txn_summary_rollup'
      ])
  loop
    execute format('revoke execute on function %s from anon, authenticated', r.sig);
  end loop;
end $$;

-- ── 2. transactions (H3): drop the blanket member-read policy ──
-- Members never read transactions via their JWT in this app — the dashboard/Bank/
-- Payments pages all read via the service role and gate on page-access in the API
-- layer. This stops a restricted / search-only member from dumping the whole
-- payments book (and customer PII) directly off PostgREST. Owners keep full access
-- via the pre-existing owner "*_org_members_all" policy.
drop policy if exists "transactions_member_reads" on transactions;
