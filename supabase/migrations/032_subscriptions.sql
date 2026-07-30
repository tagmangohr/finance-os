-- ============================================================
-- FILE: 032_subscriptions.sql
-- Subscriptions as a FIRST-CLASS, cross-gateway entity + lifecycle event log.
--
-- Why: recurring revenue lives across Cashfree, Stripe, Razorpay, App Store (and,
-- when connected, PayU/Paytm/Easebuzz), each with its own subscription model. To
-- report on it uniformly — active count, renewals, cancellations, churn, MRR/ARR,
-- dunning, upcoming renewals, revenue by plan — we normalize every gateway into ONE
-- `subscriptions` row per subscription (current state + key dates) plus a
-- `subscription_events` log (one row per lifecycle transition / charge) that powers
-- the time-series reports. Both keep the full `raw` payload (raw-first, like
-- transactions.raw) so any field we don't surface yet is a display-only change later.
--
-- This is ADDITIVE: it does not touch `transactions`, the existing
-- `cashfree_subscriptions` registry, or any ingestion path. Writers migrate over in
-- application code; nothing breaks on apply.
-- ============================================================

-- ── Unified subscription entity (one row per subscription, current state) ───────
create table if not exists public.subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null,
  connector_id          uuid,                       -- nullable: App Store relay etc. may not map 1:1
  gateway               text not null,              -- cashfree | stripe | razorpay | app_store | payu | paytm | easebuzz
  subscription_id       text not null,              -- gateway-native id (canonical; e.g. sub_…, originalTransactionId)

  -- Customer (denormalized so every report/export carries customer detail without a join)
  customer_name         text,
  customer_email        text,
  customer_phone        text,
  customer_gateway_id    text,                      -- gateway's own customer id (cust_…, cus_…)

  -- Plan / pricing
  plan_id               text,
  plan_name             text,
  plan_amount           numeric,                    -- recurring amount in `currency`
  currency              text,
  amount_base           numeric,                    -- INR-normalized recurring amount (for cross-currency MRR)
  billing_interval      text,                       -- day | week | month | year
  interval_count        integer,                    -- e.g. every 3 months → interval_count=3

  -- Status (normalized + native)
  status                text,                       -- trialing | active | past_due | paused | cancelled | expired | completed | unknown
  native_status         text,                       -- gateway's own status string, verbatim
  auto_renew            boolean,
  cancel_at_period_end   boolean,
  cancel_reason         text,                       -- voluntary | billing_failure | <gateway reason>

  -- Lifecycle dates (the backbone of the reports)
  started_at            timestamptz,                -- subscription start / first activation
  trial_start           timestamptz,
  trial_end             timestamptz,
  current_period_start   timestamptz,
  current_period_end     timestamptz,               -- current cycle end / expiry of paid access
  next_charge_at        timestamptz,                -- next scheduled renewal charge
  cancel_requested_at    timestamptz,               -- when cancellation was requested
  ended_at              timestamptz,                -- when it actually ended (cancel effective / expiry)

  -- Counters (where the gateway provides them)
  total_cycles          integer,
  paid_count            integer,
  remaining_count       integer,

  -- Payment method / mandate (for dunning + at-risk revenue)
  payment_method        text,                       -- upi | card | netbanking | …
  mandate_status        text,
  card_last4            text,
  card_expiry           text,                       -- MM/YY (renewal-risk reporting)

  -- Bookkeeping
  first_seen_at         timestamptz not null default now(),
  last_event_type       text,
  last_event_at         timestamptz,
  last_synced_at        timestamptz,                -- last time a pull (API) refreshed this row
  raw                   jsonb,                      -- full latest gateway subscription payload, verbatim
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Gateway ids are globally unique per gateway, so this is the natural upsert key.
  unique (gateway, subscription_id)
);

-- Dashboard slices: active-by-gateway, renewals-due, churn windows.
create index if not exists idx_subscriptions_org_status   on public.subscriptions (org_id, status);
create index if not exists idx_subscriptions_gateway      on public.subscriptions (org_id, gateway, status);
create index if not exists idx_subscriptions_next_charge  on public.subscriptions (org_id, next_charge_at) where next_charge_at is not null;
create index if not exists idx_subscriptions_ended        on public.subscriptions (org_id, ended_at) where ended_at is not null;

comment on table public.subscriptions is
  'One row per subscription across ALL gateways (normalized status/dates/plan/customer). Powers the Subscriptions dashboard: active count, MRR, upcoming renewals, churn. Money rows live in transactions (linked by subscription_id); lifecycle transitions live in subscription_events. raw = full gateway payload.';

-- ── Lifecycle + charge event log (one row per transition; powers time-series) ───
create table if not exists public.subscription_events (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null,
  gateway               text not null,
  subscription_id       text not null,              -- links to subscriptions (gateway, subscription_id)

  event_type            text not null,              -- normalized: created | trial_started | activated | renewed |
                                                     --   charge_succeeded | charge_failed | paused | resumed |
                                                     --   cancelled | expired | refunded | plan_changed | reactivated
  native_event_type     text,                       -- gateway's own event name (SUBSCRIPTION_PAYMENT_SUCCESS, DID_RENEW, invoice.paid, …)
  event_at              timestamptz not null,

  amount                numeric,                    -- for charge events
  currency              text,
  amount_base           numeric,                    -- INR-normalized

  transaction_external_id text,                     -- link to transactions.external_id for charge events (cf_pay_…, ch_…, appstore_…)
  event_ref             text,                       -- gateway's unique id for THIS event (payment id / evt_… / notificationUUID) — dedup key
  raw                   jsonb,
  created_at            timestamptz not null default now()
);

-- Idempotency: re-delivered webhooks / re-pulled events must not duplicate. When the
-- gateway gives a unique event ref we dedup on it; the app also insert-and-catches 23505.
create unique index if not exists uq_subscription_events_ref
  on public.subscription_events (gateway, event_ref) where event_ref is not null;
-- Fallback dedup + the time-series report scans (renewals/cancellations per period).
create index if not exists idx_subscription_events_sub  on public.subscription_events (gateway, subscription_id, event_at desc);
create index if not exists idx_subscription_events_report on public.subscription_events (org_id, event_type, event_at desc);

comment on table public.subscription_events is
  'Append-only lifecycle/charge log per subscription (normalized event_type). Powers period reports: renewals, cancellations, churn, dunning, reactivations. Dedup on (gateway, event_ref); charge events link to transactions via transaction_external_id.';

-- ── RLS: service-role only (writers = webhooks/sync; reads = server-rendered,
-- admin/finance-gated dashboard using the service client scoped to the active org).
-- No client policy → invisible to the anon/authenticated API, so customer PII is
-- never exposed directly. Matches the webhook_events / cashfree_subscriptions posture.
alter table public.subscriptions      enable row level security;
alter table public.subscription_events enable row level security;
