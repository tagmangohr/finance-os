-- ============================================================
-- FILE: 031_cashfree_subscriptions.sql
-- Cashfree recurring (subscription / mandate) support.
--
-- Why: TagMango's recurring revenue is the majority of Cashfree volume, and it was
-- NEVER captured in real time — the webhook handler only ever parsed one-time
-- PAYMENT_/REFUND/DISPUTE events, and Cashfree subscription events (SUBSCRIPTION_*)
-- were neither subscribed to nor normalized. Recurring charges only ever trickled
-- in AFTER settlement, via the settled-only recon report, so the day-to-day view
-- was missing the largest chunk of sales.
--
-- Cashfree exposes NO "list all subscriptions" endpoint — you can only fetch a
-- subscription (and its payments) BY ID. So the only way we learn a subscription
-- exists is when Cashfree pushes us an event for it. This table is that registry:
-- every subscription_id we ever see (via webhook) is recorded here, and the nightly
-- poller walks it to self-heal missed/failed recurring charges by re-fetching
-- GET /pg/subscriptions/{id}/payments. It is an INTERNAL mechanism (service-role
-- only); the actual money rows live in `transactions` (source = cashfree_subscription)
-- and are what the UI reads.
-- ============================================================

-- ── Recurring charge rows reuse the existing dedup key (NO double-count) ────────
-- A subscription charge IS a payment with its own globally-unique cf_payment_id, and
-- that SAME payment also appears in the settlement-recon backfill. So recurring
-- charges are stored with the IDENTICAL identity recon uses —
--   source      = 'cashfree'
--   external_id = 'cf_pay_<cf_payment_id>'
-- — which makes the webhook/poll row and the later recon row dedup onto ONE row
-- (dedup is on external_id). Keying them differently (e.g. cf_subpay_) would create a
-- second row for the same money and DOUBLE-COUNT revenue. `raw` (migration 030) still
-- stores the full payload.
--
-- The one thing recon can't tell us is "this payment was recurring", so we add a
-- durable marker column that the generic refresh path never overwrites:
alter table public.transactions add column if not exists subscription_id text;
comment on column public.transactions.subscription_id is
  'Non-null when this payment is a recurring/subscription charge (the gateway subscription id). Set by the subscription webhook/poller; NEVER written by the recon/one-time refresh path, so it survives re-syncs. Recurring revenue = rows where subscription_id is not null.';
-- Partial index: fast "recurring revenue" slices without bloating the common case.
create index if not exists idx_transactions_subscription
  on public.transactions (org_id, subscription_id)
  where subscription_id is not null;

-- ── Subscription registry (lifecycle state + poller work-list) ──────────────────
create table if not exists public.cashfree_subscriptions (
  subscription_id   text not null,                 -- Cashfree subscription_id (a.k.a. subscription_reference_id)
  connector_id      uuid not null,                 -- the cashfree connector this belongs to
  org_id            uuid not null,
  status            text,                           -- ACTIVE | BANK_APPROVAL_PENDING | CANCELLED | COMPLETED | ...
  plan_name         text,
  plan_amount       numeric,                        -- recurring amount (full currency units)
  currency          text,
  customer_name     text,
  customer_email     text,
  customer_phone     text,
  first_charge_at   timestamptz,                    -- earliest charge time we've observed
  next_charge_at    timestamptz,                    -- next scheduled charge (from Cashfree, when provided)
  last_event_type   text,                           -- most recent SUBSCRIPTION_* event applied
  last_event_at     timestamptz,                    -- when that event was received
  last_polled_at    timestamptz,                    -- when the poller last fetched this subscription's payments
  raw               jsonb,                          -- full latest subscription payload (verbatim, like transactions.raw)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (subscription_id, connector_id)
);

-- Poller work-list ordering: least-recently-polled active subs first.
create index if not exists idx_cf_subs_poll
  on public.cashfree_subscriptions (connector_id, last_polled_at asc nulls first);
-- Org-scoped lookups (e.g. an admin subscriptions view later).
create index if not exists idx_cf_subs_org
  on public.cashfree_subscriptions (org_id, status);

comment on table public.cashfree_subscriptions is
  'Registry of every Cashfree subscription we have observed via SUBSCRIPTION_* webhooks. Cashfree has no list-subscriptions API, so this IS our enumeration of them; the nightly poller re-fetches each one''s payments to self-heal missed recurring charges. Money rows live in transactions (source=cashfree_subscription).';

alter table public.cashfree_subscriptions enable row level security;
-- Service role (webhook handler + poller) bypasses RLS. No client policy is granted,
-- so this internal registry is invisible to the anon/authenticated API by default —
-- the UI reads recurring MONEY from `transactions`, not from here. (Matches the
-- webhook_events table's posture; add an org-scoped read policy later only if a
-- subscriptions UI needs direct access.)
