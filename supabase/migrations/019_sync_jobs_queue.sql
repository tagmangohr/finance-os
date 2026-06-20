-- Pillar 2 — durable background sync queue.
--
-- Large backfills can't finish inside one Vercel function. Instead of running the
-- work in-request, we ENQUEUE bounded windows here and a draining worker
-- (/api/cron/process-sync-jobs, every minute + on-demand kick) processes them
-- with retries and backoff. Each job is one connector × one bounded date window,
-- idempotent via external_id dedup — so retries and overlaps never corrupt data.

create table if not exists public.sync_jobs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  connector_id  uuid not null references public.connectors(id)   on delete cascade,
  type          text not null,
  window_from   timestamptz not null,
  window_to     timestamptz not null,
  status        text not null default 'pending'
                  check (status in ('pending', 'running', 'done', 'failed')),
  attempts      int  not null default 0,
  max_attempts  int  not null default 5,
  run_after     timestamptz not null default now(),
  locked_at     timestamptz,
  locked_by     text,
  last_error    text,
  result        jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Drain order + fast claim: pending/eligible jobs by schedule.
create index if not exists idx_sync_jobs_claim
  on public.sync_jobs (status, run_after);
create index if not exists idx_sync_jobs_connector
  on public.sync_jobs (connector_id, created_at desc);
create index if not exists idx_sync_jobs_org
  on public.sync_jobs (org_id, created_at desc);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Members can READ their org's jobs (for the backfill progress UI). All writes go
-- through the service role (worker / enqueue routes), which bypasses RLS.
alter table public.sync_jobs enable row level security;

drop policy if exists sync_jobs_member_read on public.sync_jobs;
create policy sync_jobs_member_read on public.sync_jobs
  for select using (auth_is_active_member(org_id));

-- ── Atomic claim ──────────────────────────────────────────────────────────────
-- Claims up to p_batch eligible jobs (pending & due, or running but stale-locked),
-- flips them to running, stamps the worker + attempt. FOR UPDATE SKIP LOCKED makes
-- concurrent/overlapping worker invocations safe — they never grab the same job.
create or replace function public.claim_sync_jobs(p_batch int, p_worker text)
returns setof public.sync_jobs
language plpgsql
as $$
begin
  return query
  update public.sync_jobs j
  set status    = 'running',
      locked_at = now(),
      locked_by = p_worker,
      attempts  = j.attempts + 1,
      updated_at = now()
  where j.id in (
    select c.id
    from public.sync_jobs c
    where (c.status = 'pending' and c.run_after <= now())
       or (c.status = 'running' and c.locked_at < now() - interval '5 minutes')
    order by c.run_after
    limit p_batch
    for update skip locked
  )
  returning j.*;
end;
$$;
