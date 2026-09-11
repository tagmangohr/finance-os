-- 105_sync_integrity.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Item 15 — resync_connector_pnl_flags statement_timeout.
-- This RPC does an org-wide UPDATE of transactions + four rollup rebuilds when a
-- connector's P&L include/exclude toggle changes. Migration 100 raised the timeout
-- on every other heavy rollup RPC but MISSED this one, so on the large org it errors
-- at PostgREST's 8s limit and leaves the rollups half-rebuilt (stale until the nightly
-- reconcile heals them).
alter function resync_connector_pnl_flags(uuid) set statement_timeout = '600s';

-- ─────────────────────────────────────────────────────────────────────────────
-- Item 10 — GLOBAL dedup guard.
-- The app dedups on (org_id, external_id), but the only DB uniqueness was
-- (org_id, connector_id, external_id) — so the SAME charge re-ingested under a new
-- connector (a reconnect), or two concurrent syncs racing, could double-insert and
-- inflate revenue + every rollup. Add a non-partial unique index on
-- (org_id, external_id) so the database enforces the rule the app already assumes,
-- and the insert path can upsert ON CONFLICT DO NOTHING against it.
--   • NULL external_ids stay DISTINCT (Postgres default), so manual / unmatched rows
--     are unconstrained — exactly as today.
--   • Split children carry distinct '<parent_ext>__split_N' ids, so they never collide.
--   • Verified: 0 existing (org_id, external_id) duplicates in either org, so it builds.
-- Non-partial (not `WHERE external_id IS NOT NULL`) is required so PostgREST's upsert
-- onConflict can target it. Building it briefly locks writes on the transactions table
-- (~seconds at 478k rows) — apply during a quiet moment.
create unique index if not exists uq_transactions_org_external
  on transactions (org_id, external_id);
