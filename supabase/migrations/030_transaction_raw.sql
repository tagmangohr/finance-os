-- ============================================================
-- FILE: 030_transaction_raw.sql
-- Store the COMPLETE raw source payload on every transaction.
--
-- Why: today we normalize each gateway/webhook/CSV record into curated columns
-- + a small `metadata` subset and DISCARD the rest. So whenever a field we never
-- captured is needed (payment method, bank reference, settlement batch, GST
-- breakup, …) the only way to get it is to re-fetch from the gateway. Storing the
-- full payload verbatim makes any future field a display-only change, never a
-- re-fetch. `metadata` stays the indexed/searchable subset; `raw` is the full record.
-- ============================================================

-- Full unmodified source object (gateway API object / webhook body / CSV row).
-- Nullable: existing rows have none until the one-time backfill re-sync populates
-- them. NOT selected by default in normal queries, so the (potentially large) blob
-- never weighs down metrics/list reads.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS raw jsonb;

-- Cheap presence flag. The dedup/existence check selects THIS (a boolean) instead
-- of the raw blob, and the sync layer treats "row exists but has_raw = false" as a
-- change so any re-sync self-heals missing raw. Generated + STORED so it's always
-- correct and never written by the app.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS has_raw boolean
  GENERATED ALWAYS AS (raw IS NOT NULL) STORED;

COMMENT ON COLUMN transactions.raw IS
  'Complete unmodified source payload this row was normalized from. metadata is the curated searchable subset; raw is the full record. Populated on ingest + by re-sync backfill.';
