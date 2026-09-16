-- 128_sync_jobs_per_org_serialize.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Per-org serialization of the background sync queue — the root-cause fix for the
-- recurring "canceling statement due to statement timeout" (57014) and "deadlock
-- detected" (40P01) failures on Sync Health.
--
-- Root cause: claim_sync_jobs claimed up to p_batch jobs with no per-org isolation,
-- and the worker ran them concurrently (Promise.all). So when one org's Razorpay,
-- Stripe and google_sheets connectors were all due in the same minute, a gateway's
-- per-row UPDATE on `transactions` (which fires 6+ rollup triggers) ran AT THE SAME
-- TIME as that org's heavy rollup REBUILD (the sheet job's rebuild_org_rollups, or
-- the nightly rebuild_all_rollups which TRUNCATEs the rollup tables):
--   • the gateway UPDATE blocked on a rollup-table lock held by the rebuild and was
--     canceled at the ~8s role statement_timeout  → 57014; and
--   • because the gateway triggers and the rebuild touch the rollup tables in the
--     opposite order, the two transactions deadlocked → 40P01.
--
-- Fix: claim at most ONE job per org per batch, and never claim a job whose org
-- already has a FRESH running job. So gateway ingest and a rollup rebuild for the
-- SAME org can never run at the same time. DIFFERENT orgs still run concurrently
-- (they touch disjoint rollup rows), so fleet throughput is unchanged; a single
-- org's jobs now run one-at-a-time, which is exactly what we want. Crash recovery is
-- unchanged: a running job whose lock is stale (>5 min) is still reclaimable, and a
-- stale-running job does NOT block its org (the freshness check uses locked_at).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.claim_sync_jobs(p_batch int, p_worker text)
returns setof public.sync_jobs
language plpgsql
as $$
begin
  return query
  update public.sync_jobs j
  set status     = 'running',
      locked_at  = now(),
      locked_by  = p_worker,
      attempts   = j.attempts + 1,
      updated_at = now()
  where j.id in (
    -- Take the earliest eligible job PER ORG (row_number rn=1), skipping any org that
    -- already has a fresh running job, then the earliest p_batch of those across orgs.
    -- FOR UPDATE SKIP LOCKED on the eligible base rows keeps concurrent workers off
    -- the same rows, so two workers never grab the same job (or the same org's rows).
    select ranked.id
    from (
      select locked.id, locked.org_id, locked.run_after,
             row_number() over (partition by locked.org_id
                                 order by locked.run_after, locked.id) as rn
      from (
        select c.id, c.org_id, c.run_after
        from public.sync_jobs c
        where (
              (c.status = 'pending' and c.run_after <= now())
           or (c.status = 'running' and c.locked_at < now() - interval '5 minutes')
        )
        and not exists (
          select 1
          from public.sync_jobs r
          where r.org_id   = c.org_id
            and r.status   = 'running'
            and r.locked_at >= now() - interval '5 minutes'
        )
        order by c.run_after
        limit 500
        for update skip locked
      ) locked
    ) ranked
    where ranked.rn = 1
    order by ranked.run_after
    limit p_batch
  )
  returning j.*;
end;
$$;
