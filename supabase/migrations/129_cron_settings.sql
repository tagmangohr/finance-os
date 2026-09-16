-- 129_cron_settings.sql
-- Per-cron On/Off control for the Sync Health page. Vercel cron schedules are STATIC
-- config (vercel.json) — you cannot pause a Vercel cron from the app. So "off" is an
-- in-route gate: the cron still fires on schedule, checks this table first, and no-ops
-- when disabled. Global (not per-org) — one deployment runs one set of crons for every
-- org, exactly like cron_runs (migration 106).
--
-- Default-ON semantics: a missing row (or this table not existing yet, pre-migration)
-- means ENABLED, so shipping the gate code before this migration — or a cron with no
-- row — never silently halts a job. Only an explicit `enabled = false` row pauses one.
create table if not exists public.cron_settings (
  job_name    text primary key,          -- 'nightly-sync' | 'mercury-balances' | 'snapshot' | 'process-sync-jobs' | 'deliver-webhooks' | 'fx-backfill' | 'drive-sync'
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid,                       -- auth.users id of the owner/admin who last flipped it (no FK: avoid cross-schema coupling; informational only)
  created_at  timestamptz not null default now()
);

-- Service-role only, same posture as cron_runs: the crons READ it via the service role
-- and the toggle API WRITES it via the service role (gated by canManageOrg — owner/admin
-- — in the app layer). RLS on with NO client policy = default-deny to anon/authenticated,
-- so it is never exposed on the public REST API. Belt-and-suspenders grants below.
alter table public.cron_settings enable row level security;
revoke all on public.cron_settings from anon, authenticated;
grant all on public.cron_settings to service_role;
