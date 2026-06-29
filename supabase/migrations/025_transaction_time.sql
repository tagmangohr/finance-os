-- Full transaction timestamp (UTC). `transaction_date` stays the date-only column
-- (used everywhere for filtering + existing indexes); `transaction_at` adds the
-- precise time the gateway reported, so the Raw Data table can show AND sort by
-- the transaction time (displayed in IST, 24-hour). Nullable: historical rows are
-- backfilled separately, and sources without a real time (CSV) stay null.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS transaction_at timestamptz;

-- Sort/scan by precise time within an org.
CREATE INDEX IF NOT EXISTS idx_transactions_org_txn_at
  ON transactions (org_id, transaction_at DESC);
