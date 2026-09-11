-- 106_cron_runs.sql
-- A lightweight run-log for the scheduled crons + the sync worker, so the Sync Health
-- page can show whether the nightly rollup rebuild / snapshot / FX-backfill / drive-sync
-- / sync-worker are actually running and succeeding (today they only log to Vercel's
-- console, which nobody watches). Global (not per-org) — crons process every org.
create table if not exists public.cron_runs (
  id           uuid primary key default gen_random_uuid(),
  job_name     text not null,   -- 'nightly-sync' | 'snapshot' | 'fx-backfill' | 'drive-sync' | 'process-sync-jobs'
  status       text not null check (status in ('running', 'ok', 'failed')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  duration_ms  integer,
  error        text,
  meta         jsonb,
  created_at   timestamptz not null default now()
);

-- Latest runs per job (the page lists the most recent N) + a global-recent index.
create index if not exists idx_cron_runs_job    on public.cron_runs (job_name, started_at desc);
create index if not exists idx_cron_runs_recent on public.cron_runs (started_at desc);

-- Service-role only: the crons write via the service role and the Health page reads via
-- the service role (gated by page-access in the app layer). RLS on with no client policy
-- = default deny to anon/authenticated, so it's never exposed on the public REST API.
alter table public.cron_runs enable row level security;
