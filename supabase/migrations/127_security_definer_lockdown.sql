-- 127_security_definer_lockdown.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Multi-tenant hardening (audit follow-up).
--
-- FINDING #2 — PUBLIC-executable maintenance/writer SECURITY DEFINER functions.
-- Postgres grants EXECUTE to PUBLIC on every new function; migration 103 revoked
-- these from anon/authenticated but NOT from PUBLIC, so any anon/authenticated
-- caller could still `POST /rest/v1/rpc/<fn>` and run them AS THE OWNER. The
-- rebuild_* functions TRUNCATE + recompute EVERY org's rollups (a full-table DoS
-- + a race against live triggers); tag_subscription_charges / resync_connector_
-- pnl_flags are cross-org writers. None of these are ever called by an
-- authenticated client — every caller uses the service client (cron/sync/jobs) —
-- so we revoke EXECUTE from PUBLIC (and anon/authenticated) and grant only
-- service_role. Name-based loop (mirrors 103/104) so every overload is covered.
--
-- FINDING #4 — api_keys RLS drift. RLS is already ON in the live DB (verified: an
-- anon PostgREST read returns 0 of N rows) but no migration expresses it, so a
-- fresh provision from migrations alone would ship the table WITHOUT RLS. Assert
-- it here (idempotent) so the protected state is reproducible. api_keys is read
-- only via the service client (verifyApiKey / settings routes), so RLS-on with no
-- user policy (deny-all to anon/authenticated, service bypasses) is the correct
-- and unchanged behavior.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Finding #2: PUBLIC → service_role only, on the maintenance/writer definers ──
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'rebuild_dash_rollups','rebuild_pnl_rollups','rebuild_revenue_gateway_rollups',
        'rebuild_fees_gateway_rollups','rebuild_metric_rollups','refresh_metric_rollups',
        'rebuild_all_rollups','rebuild_org_rollups','rebuild_txn_summary_rollup',
        'tag_subscription_charges','resync_connector_pnl_flags'
      ])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    execute format('grant  execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- ── Finding #4: assert api_keys RLS (idempotent; no policy = deny-all to users) ──
alter table if exists api_keys enable row level security;
