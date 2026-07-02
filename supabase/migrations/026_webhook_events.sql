-- Webhook observability: one row per inbound webhook, whatever its fate.
--
-- Why: real-time ingestion (esp. Cashfree) is a black box — if a gateway sends
-- an event we never see it unless it persists. This logs EVERY inbound webhook
-- and its outcome (signature pass/fail, ignored, persisted, error) so we can tell
-- apart "the gateway isn't sending it" from "we received it and dropped it".
-- Insert-only, never in a hot read path; safe to prune later.

create table if not exists public.webhook_events (
  id              uuid primary key default gen_random_uuid(),
  received_at     timestamptz not null default now(),
  provider        text not null,                 -- 'cashfree' | 'stripe' | 'razorpay'
  event_type      text,                          -- payload.type (best-effort, even if signature failed)
  signature_ok    boolean not null default false,
  outcome         text not null,                 -- missing_headers | signature_failed | bad_json | ignored | persisted | persist_error
  connector_id    uuid,                          -- matched connector (null if unmatched)
  org_id          uuid,
  external_id     text,                          -- cf_pay_… when normalized
  order_id        text,
  amount          numeric,
  status          text,                          -- normalized txn status
  error           text,                          -- error message on persist_error
  payload         jsonb                          -- parsed body for post-hoc inspection
);

-- Recent-first browsing + per-provider/per-outcome rollups.
create index if not exists idx_webhook_events_received on public.webhook_events (received_at desc);
create index if not exists idx_webhook_events_provider_outcome on public.webhook_events (provider, outcome, received_at desc);

alter table public.webhook_events enable row level security;
-- Service role (webhook handler + admin queries) bypasses RLS; no client policy is
-- granted, so this table is invisible to the anon/authenticated API by default.
