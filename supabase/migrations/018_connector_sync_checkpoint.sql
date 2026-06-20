-- Pillar 1 — incremental sync checkpoint.
--
-- `synced_through` is the forward edge each connector is caught up to. Incremental
-- syncs only fetch [synced_through - overlap, now] in bounded steps, so steady-
-- state work is tiny regardless of history size or how many connectors exist.
-- This is what lets the hourly cron sync 50+ connectors in one function without
-- ever approaching the Vercel timeout.

alter table public.connectors
  add column if not exists synced_through timestamptz;

-- Existing API connectors have been kept current by the old 90-day cron, so
-- anchor their checkpoint at their last successful sync (fall back to now).
-- Incremental re-syncs a short trailing overlap from here and then only moves
-- forward — no gap, no full re-backfill.
update public.connectors
  set synced_through = coalesce(last_synced_at, now())
  where synced_through is null
    and type in ('razorpay', 'stripe', 'cashfree', 'payu', 'paytm', 'easebuzz');

-- Make dedup + checkpoint lookups by connector and recency cheap.
create index if not exists idx_transactions_connector_date
  on public.transactions (connector_id, transaction_date desc);
