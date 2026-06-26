-- 023: Stripe events-delta checkpoint
--
-- Tracks the created-time of the last Stripe event we've processed, so the nightly
-- sync can pull ONLY what changed since then (new charges, status changes, refunds,
-- disputes, payouts) via Stripe's /v1/events feed — instead of re-scanning the whole
-- financial year (~71k charges, ~56 min). Events stay flat in cost as data grows.
--
-- Column-tolerant rollout: the app reads this off the connector row and falls back to
-- the existing full backfill whenever it's null/absent, so deploying the code before
-- (or without) this migration is harmless.

alter table connectors add column if not exists events_synced_through timestamptz;

-- Existing Stripe connectors are already fully backfilled, so seed the checkpoint a
-- couple of days back: the first nightly run does a tiny events delta (re-checking the
-- last ~2 days for safety overlap) rather than a redundant full re-scan. Other gateways
-- are untouched — they keep their cheap full re-scan.
update connectors
   set events_synced_through = now() - interval '2 days'
 where type = 'stripe'
   and status = 'active'
   and events_synced_through is null;
