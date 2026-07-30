-- ============================================================
-- FILE: 033_invoices.sql
-- Invoices as a first-class, raw-first entity — the BRIDGE between a charge and a
-- subscription for Stripe/Razorpay, and the source of renewal-vs-new + tax detail.
--
-- Why: Stripe/Razorpay put the subscription id on the INVOICE, not the charge
-- (charge → invoice → subscription). To tag every subscription charge in
-- `transactions` with its subscription_id (the CFO-grade invariant: one charge = one
-- transaction row, optionally carrying a subscription_id), we capture invoices and
-- use them as the mapping: invoice.charge_external_id → transactions.external_id, and
-- invoice.subscription_id → subscriptions. Invoices also carry `billing_reason`
-- (subscription_create vs subscription_cycle = NEW vs RENEWAL) and tax/discount, which
-- the subscription reports need. Raw-first: the full gateway invoice is kept verbatim.
--
-- Additive: touches nothing existing. Money still lives ONLY in `transactions`;
-- invoices are a dimension/bridge, never summed as revenue.
-- ============================================================

create table if not exists public.gateway_invoices (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null,
  connector_id          uuid,
  gateway               text not null,              -- stripe | razorpay | cashfree | ...
  invoice_id            text not null,              -- gateway-native invoice id (in_… / inv_…)

  subscription_id       text,                       -- the subscription this invoice bills (NULL = one-off invoice)
  customer_gateway_id   text,
  customer_name         text,
  customer_email        text,
  customer_phone        text,

  status                text,                       -- normalized: paid | open | void | uncollectible | draft
  native_status         text,
  billing_reason        text,                       -- subscription_create | subscription_cycle | subscription_update | manual | …

  amount                numeric,                    -- invoice total in `currency`
  currency              text,
  amount_base           numeric,                    -- INR-normalized
  tax                   numeric,
  discount              numeric,

  charge_external_id    text,                       -- links to transactions.external_id (the charge that paid this invoice)
  invoice_date          timestamptz,
  period_start          timestamptz,
  period_end            timestamptz,

  raw                   jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (gateway, invoice_id)
);

-- Tagging reconcile (invoice.subscription_id → charge), subscription drill-downs,
-- and renewal-vs-new reporting by billing_reason.
create index if not exists idx_gwinvoices_sub      on public.gateway_invoices (org_id, subscription_id) where subscription_id is not null;
create index if not exists idx_gwinvoices_charge    on public.gateway_invoices (charge_external_id) where charge_external_id is not null;
create index if not exists idx_gwinvoices_gw_status on public.gateway_invoices (org_id, gateway, status);

comment on table public.gateway_invoices is
  'Gateway invoices (raw-first). The bridge that lets us tag transactions with subscription_id (invoice.charge_external_id → transactions.external_id; invoice.subscription_id → subscriptions) and report new-vs-renewal via billing_reason + tax. A dimension, never summed as revenue (money lives in transactions).';

alter table public.gateway_invoices enable row level security;
-- Service-role only (writers = webhooks/sync; reads = admin-gated server dashboard).
