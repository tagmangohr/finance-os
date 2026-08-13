-- App Store financial reports — the fee/net truth Apple only discloses in the
-- monthly Financial Report. The relay (App Store Server Notifications V2) carries
-- the CUSTOMER PRICE only; it never sends commission/proceeds. The report closes
-- that gap: Customer Price (gross) vs Partner Share (net proceeds), the difference
-- being Apple's total deduction (commission + local VAT/GST/levies).
--
-- The report carries NO transaction identifier — only date/product/country/price —
-- so it cannot be joined 1:1 to relay rows. But the payout ratio is stable per
-- (country × sku), so we:
--   • store every parsed line here (exact aggregates come straight from this table)
--   • derive a (country × sku) → payout_ratio table
--   • attribute metadata.fee = amount × (1 − ratio) onto relay transactions.
-- See lib/connectors/app-store-report.ts and lib/connectors/app-store-rates.ts.
-- Whole gap is booked as one fee (commission + tax not separated) — by design.

-- ── Raw report line items (idempotent replace-by-period) ─────────────────────
create table if not exists public.app_store_financial_lines (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  connector_id     uuid references public.connectors(id) on delete set null,
  -- Apple fiscal-report period, derived from the file's Start/End header dates
  -- (e.g. "2025-12"). Re-uploading a period deletes+reinserts its rows → idempotent.
  report_period    text not null,
  period_start     date,
  period_end       date,
  transaction_date date,
  settlement_date  date,
  apple_identifier text,                       -- numeric product id, e.g. 6755225332
  sku              text,                       -- bundle string, e.g. com.aifiesta.pro.monthly
  title            text,
  product_type     text,                       -- IAY (auto-renew) / IA1 (non-consumable) / …
  country          text not null,              -- alpha-2 (Country of Sale)
  quantity         integer not null default 0,
  partner_share          numeric not null default 0,  -- per-unit net proceeds
  extended_partner_share numeric not null default 0,  -- partner_share × quantity (signed for returns)
  partner_currency       text,
  customer_price         numeric not null default 0,  -- per-unit gross
  customer_currency      text,
  sale_or_return         text,                        -- 'S' | 'R'
  promo_code             text,
  order_type             text,
  region                 text,
  created_at       timestamptz not null default now()
);

create index if not exists idx_asfl_org_period  on public.app_store_financial_lines(org_id, report_period);
create index if not exists idx_asfl_country_sku  on public.app_store_financial_lines(org_id, country, sku);
create index if not exists idx_asfl_txn_date     on public.app_store_financial_lines(org_id, transaction_date);

-- ── Derived effective payout rate per (country × sku) ────────────────────────
create table if not exists public.app_store_payout_rates (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  country_alpha2 text not null,               -- as it appears in the report
  country_alpha3 text,                        -- filled via the alpha2→alpha3 map, for relay lookups (metadata.storefront is alpha-3)
  sku            text not null,
  payout_ratio   numeric not null,           -- partner_share / customer_price ∈ (0,1]
  sample_customer_price numeric,
  sample_partner_share  numeric,
  currency       text,
  units          integer not null default 0, -- sale units that backed this rate
  updated_at     timestamptz not null default now(),
  unique (org_id, country_alpha2, sku)
);

create index if not exists idx_aspr_lookup on public.app_store_payout_rates(org_id, country_alpha3, sku);

-- Service-role only: reads/writes go through admin-gated server routes. No client
-- policy (mirrors gateway_events / other sensitive tables).
alter table public.app_store_financial_lines enable row level security;
alter table public.app_store_payout_rates    enable row level security;

-- ── Attribute metadata.fee onto relay transactions from the derived rates ────
-- Set-based (one indexed join, jsonb_set) so it never read-modify-writes per row.
-- fee = amount × (1 − payout_ratio), in the row's own currency — exactly what the
-- Fees / Net Flow aggregate (migration 052) expects; it FX-converts via fx_rate.
-- Match key: relay rows carry metadata.storefront (ISO alpha-3) + metadata.product_id
-- (the SKU); the rate table is keyed the same way. fill-only unless p_overwrite.
create or replace function public.backfill_app_store_fees(p_org uuid, p_overwrite boolean default false)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  with upd as (
    update public.transactions t
    set metadata = jsonb_set(
      coalesce(t.metadata, '{}'::jsonb),
      '{fee}',
      to_jsonb(round((t.amount * (1 - r.payout_ratio))::numeric, 2)),
      true
    )
    from public.app_store_payout_rates r
    where t.org_id = p_org
      and t.source = 'app_store'
      and t.amount > 0
      and r.org_id = p_org
      and r.sku = (t.metadata->>'product_id')
      and r.country_alpha3 = (t.metadata->>'storefront')
      and (p_overwrite or (t.metadata->>'fee') is null)
    returning 1
  )
  select count(*) into n from upd;
  return n;
end
$$;

grant execute on function public.backfill_app_store_fees(uuid, boolean) to service_role;
