-- Resumable sync jobs — make backfills of any size unbreakable on serverless.
--
-- A job no longer tries to sync a whole date window in one (timeout-bound) call.
-- Instead it paginates a connector's streams with a saved cursor, a bounded
-- chunk at a time: fetch ~25s worth, persist, save the cursor, stay pending, and
-- continue on the next worker pass. The cursor only moves forward, so every
-- record is fetched exactly once (zero redundancy) and no single function call
-- can exceed the budget regardless of volume (5+ years is just more chunks).

alter table public.sync_jobs
  -- which stream of the connector is currently being paginated (e.g. 'charges',
  -- 'payouts'); null = not started → begins at the connector's first stream.
  add column if not exists stream             text,
  -- opaque pagination cursor within the current stream (Stripe starting_after id,
  -- offset for skip-based gateways); null = start of the stream.
  add column if not exists cursor             text,
  -- running count of records fetched so far (telemetry / progress).
  add column if not exists processed          integer not null default 0,
  -- incremental jobs advance the connector's synced_through checkpoint when done.
  add column if not exists advance_checkpoint boolean not null default false;
