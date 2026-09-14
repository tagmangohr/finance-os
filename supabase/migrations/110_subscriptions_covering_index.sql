-- ─────────────────────────────────────────────────────────────────────────────
-- 110 · Covering index for the Subscriptions metric RPCs (index-only scans)
-- ─────────────────────────────────────────────────────────────────────────────
-- The Subscriptions dashboard fires 6 RPCs in parallel; the heavy ones measured
-- subscription_mix_now 6.1s, subscription_monthly_metrics 4.3s, cohort 2.0s,
-- status_now 1.7s. Five of them scan the org's ~139k `subscriptions` rows and, for
-- each row, derive period_end / mrr from a wide column set:
--     gateway, amount_base, billing_interval, status, next_charge_at,
--     current_period_end, last_charge_at, started_at, ended_at, cancel_requested_at
-- The filter (org_id, started_at) is indexed (idx_subs_org_started), but NONE of those
-- projected columns are in any index — so the plan is: index-find the org rows, then
-- HEAP-FETCH every one of ~139k wide rows. That heap trip is the bulk of the latency.
--
-- This covering index puts the whole projected column set in the index (INCLUDE), so the
-- metric RPCs run as INDEX-ONLY scans — no heap visits. The following VACUUM sets the
-- visibility map (index-only scans need all-visible pages) and refreshes stats.
--
-- Semantics-preserving: no RPC or data changes, purely a read-path index. If cold-load
-- latency is still too high after this, the next step is precomputing period_end/mrr as
-- stored columns so the per-row derivation disappears too (a separate, reviewed change).
--
-- Also drops idx_subs_org_status (060) — an exact duplicate of idx_subscriptions_org_status
-- (032), both (org_id, status); redundant write cost, no query needs both.
--
-- ── HOW TO APPLY — run each statement ONE AT A TIME in the Supabase SQL editor.
--    CREATE/DROP INDEX CONCURRENTLY and VACUUM cannot run inside a transaction block. ──

-- 1) Covering index → index-only scans for status_now / mix_now / monthly_metrics / cohort.
create index concurrently if not exists idx_subs_rpc_cover
  on subscriptions (org_id, started_at)
  include (gateway, amount_base, billing_interval, status, next_charge_at,
           current_period_end, last_charge_at, ended_at, cancel_requested_at)
  where started_at is not null;

-- 2) Drop the duplicate (org_id, status) index.
drop index concurrently if exists idx_subs_org_status;

-- 3) Set the visibility map (so the index-only scan skips the heap) + refresh stats.
vacuum (analyze) subscriptions;
