-- 081_dispute_index.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Fast lookup of dispute rows.
--
-- The P&L "Chargebacks (lost)" line, the Bank collections tie-out, and the
-- Analytics page all call getLostDisputesByMonth, which filters
-- transactions WHERE org_id = ? AND category = 'dispute' AND date range. There is
-- no index covering `category`, so Postgres scans a large slice of the ~412k-row
-- table to find the ~760 dispute rows — measured at ~3.6s, and it sits on the
-- critical path of three pages (a real intermittent-timeout / 500 risk under load).
--
-- A tiny PARTIAL index on just the dispute rows makes that lookup index-only and
-- near-instant, without adding write overhead to the 99.8% of rows that aren't
-- disputes.
-- ─────────────────────────────────────────────────────────────────────────────

create index if not exists idx_transactions_dispute
  on transactions (org_id, transaction_date)
  where category = 'dispute';
