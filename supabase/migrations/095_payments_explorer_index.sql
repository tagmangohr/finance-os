-- 095_payments_explorer_index.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY: the Payments explorer (/api/transactions + /api/transactions/summary) shows
-- EXACT row totals. On the large payments ledger (Fiesta ≈ 454k rows) an exact
-- count / grouped aggregate was hitting the 8s statement timeout for any window
-- wider than ~1 day, so the page failed to load. Root cause was a planner regression:
-- with dead-tuple bloat + stale stats the planner switched from an index scan to a
-- SEQUENTIAL SCAN of the wide `raw`-jsonb heap (hundreds of MB) — catastrophic for
-- a count that must visit every matching row.
--
-- FIX (exact + scalable, no estimated shortcut): a PARTIAL, COVERING index scoped to
-- the payments ledger over exactly the explorer's filter columns. Because the ledger
-- predicate lives in the index's WHERE clause and every non-search filter column is
-- in the key, Postgres answers `count(*)` (and the ordered page fetch) with an
-- INDEX-ONLY scan over narrow entries (~60 bytes each) instead of touching the wide
-- heap. Exact counts stay in the tens-of-ms range and scale to millions of rows.
--
-- Covers: total (no filter), + date range, + connector_id, + source, + type, and any
-- combination — all as an index-only scan. (Free-text search still scans; a trigram
-- GIN index on search_text is the follow-up for that path.)
--
-- ── HOW TO APPLY (run these statements one at a time in the Supabase SQL editor;
--    NEITHER can run inside a transaction block / migration wrapper) ──────────────
--
--   1) One-off maintenance FIRST — clears the backfill's bloat and refreshes stats
--      so the planner stops choosing the seq scan immediately (restores the pages
--      even before the index finishes building):
--
--        vacuum (analyze) transactions;
--
--   2) Then build the index CONCURRENTLY (no write lock on the table; takes a few
--      seconds on ~454k rows):
--
--        create index concurrently if not exists idx_txn_payments_explorer
--          on transactions (org_id, transaction_date desc, source, type, connector_id)
--          where ledger = 'payments';
--
--        analyze transactions;
--
-- The CREATE INDEX statement below is the authoritative definition. If you prefer to
-- let the migration runner apply it inside its transaction (brief write lock, still
-- only a few seconds), just run the file as-is and drop the word `concurrently`.
-- ─────────────────────────────────────────────────────────────────────────────

create index concurrently if not exists idx_txn_payments_explorer
  on transactions (org_id, transaction_date desc, source, type, connector_id)
  where ledger = 'payments';

analyze transactions;
