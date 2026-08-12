-- ============================================================
-- FILE: 071_gateway_events_archive.sql
-- Durable, verbatim archive of EVERY inbound payment-gateway event, across all PGs.
--
-- Goal: capture everything once, derive many times. Today each webhook route
-- normalizes an event inline and only transactions.raw keeps a copy (money events
-- only); lifecycle/non-money events and 4 of 8 routes archive nothing. This table is
-- the single source of truth for raw events so future needs can be satisfied by
-- reprocessing FROM THE DB — never by re-syncing from the gateway again.
--
-- Design (per product decisions):
--  • Forward-only capture (webhooks). No historical event backfill (PG retention
--    makes it impossible for Razorpay/Cashfree anyway; transactions.raw still holds
--    historical money events).
--  • Lean storage: jsonb payload (TOAST-compressed) + a few explicit indexed scalar
--    columns for the common query dimensions. No GIN over the whole blob — add
--    targeted indexes/generated columns later if a specific query need appears; the
--    raw is always here to index.
--  • Idempotent: dedup_key (native event id, else a content hash computed in the app)
--    unique per (provider, connector_id) so re-delivered webhooks collapse to one row.
--  • Decoupled processing: rows are archived the instant they arrive (before any
--    normalization, so a parsing bug can never lose an event). processed_at /
--    process_error track a later derive step (the reprocessor) — null = pending.
--
-- Not partitioned: a global unique on (provider, connector_id, dedup_key) is worth
-- more than month partitions here (partitioning would force received_at into the key
-- and weaken dedup). Revisit with pg_partman if this ever reaches tens of millions.
-- ============================================================

create table if not exists public.gateway_events (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null,                 -- stripe|razorpay|cashfree|payu|paytm|easebuzz|app_store|mercury
  connector_id  uuid references public.connectors(id) on delete set null,
  org_id        uuid,
  event_id      text,                          -- provider's native event id when it has one (evt_…, notificationUUID, x-razorpay-event-id)
  event_type    text,                          -- provider event type (payload.type / .event / notificationType.subtype)
  dedup_key     text not null,                 -- event_id when present, else a content hash — set by the app
  occurred_at   timestamptz,                   -- when it happened at the PG (from the payload) when known
  received_at   timestamptz not null default now(),
  signature_ok  boolean not null default false,
  source        text not null default 'webhook',  -- webhook | backfill | poll
  payload       jsonb not null,                -- full verbatim event
  processed_at  timestamptz,                   -- when the derive/reprocess step consumed it (null = pending)
  process_error text
);

-- Idempotency: one row per (provider, connector, event). Re-deliveries no-op via
-- ON CONFLICT DO NOTHING against this constraint.
create unique index if not exists uq_gateway_events_dedup
  on public.gateway_events (provider, connector_id, dedup_key);

-- Common browse/query paths (lean; no GIN on payload).
create index if not exists idx_gateway_events_org_provider_time
  on public.gateway_events (org_id, provider, occurred_at desc);
create index if not exists idx_gateway_events_received
  on public.gateway_events (received_at desc);
create index if not exists idx_gateway_events_type
  on public.gateway_events (connector_id, event_type);
-- Reprocessor: quickly find unprocessed events.
create index if not exists idx_gateway_events_unprocessed
  on public.gateway_events (provider, received_at) where processed_at is null;

alter table public.gateway_events enable row level security;
-- Service role (webhook handlers + admin/reprocess) bypasses RLS; no client policy is
-- granted, so this table is invisible to the anon/authenticated API by default.

-- Per-connector capture switch — OFF by default so it's enabled per gateway on purpose.
alter table public.connectors add column if not exists capture_events boolean not null default false;

comment on table public.gateway_events is
  'Durable verbatim archive of every inbound gateway event (forward-only). Source of truth for reprocessing without re-syncing. Idempotent on (provider,connector_id,dedup_key). Capture is gated per connector by connectors.capture_events.';
