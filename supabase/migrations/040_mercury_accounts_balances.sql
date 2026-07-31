-- ============================================================
-- FILE: 040_mercury_accounts_balances.sql
-- Mercury real-time layer: per-transaction account TYPE + per-account BALANCES.
--
-- Needed for (a) filtering/treating bank vs credit-card vs treasury/investment
-- flows correctly, and (b) a true cash-position / runway from real balances (the
-- balance.updated webhook events).
-- ============================================================

-- ── transactions.account_type — Mercury account `kind` on each bank row ──────
-- Values seen from Mercury: checking | savings | treasury | investment | credit
-- (plus 'external'/'recipient' for non-Mercury). Left unconstrained (plain text)
-- so an unexpected kind never blocks ingestion; the app maps known values.
alter table transactions add column if not exists account_type text;
create index if not exists idx_transactions_bank_acct_type
  on transactions (org_id, account_type) where ledger = 'bank';

-- ── card_payment category — the checking→card bill payment / card-account
-- payment credit. Excluded from P&L so card SPEND (the line items) is the only
-- expense counted (no double-count). ──
insert into ledger_categories (org_id, slug, label, treatment, flow, sort, is_system) values
  (null, 'card_payment', 'Credit Card Payment', 'excluded', 'both', 315, true)
on conflict do nothing;

-- High-precision seed rules for the checking-side card bill payment. Refine after
-- seeing real payloads (Mercury's counterparty/description text for autopay).
insert into category_rules (org_id, match_field, match_type, match_value, category_slug, priority, source) values
  (null, 'description',  'contains', 'credit card payment', 'card_payment',      15, 'seed'),
  (null, 'description',  'contains', 'card autopay',        'card_payment',      15, 'seed'),
  (null, 'counterparty', 'contains', 'mercury credit',      'card_payment',      15, 'seed'),
  -- Checking-side legs of treasury/investment sweeps → internal transfer (excluded).
  (null, 'counterparty', 'contains', 'mercury treasury',    'internal_transfer', 15, 'seed'),
  (null, 'description',  'contains', 'treasury transfer',   'internal_transfer', 15, 'seed'),
  (null, 'counterparty', 'contains', 'mercury savings',     'internal_transfer', 15, 'seed')
on conflict do nothing;

-- ── bank_account_balances — latest balance per Mercury account ───────────────
-- Fed by the *.balance.updated webhooks and by a periodic /accounts fetch. Cash
-- position = Σ(checking+savings+treasury current_balance) − Σ(credit current_balance).
create table if not exists bank_account_balances (
  id                   uuid        primary key default gen_random_uuid(),
  org_id               uuid        not null references organizations (id) on delete cascade,
  connector_id         uuid        not null references connectors (id) on delete cascade,
  account_id           text        not null,
  account_name         text,
  kind                 text,       -- checking | savings | treasury | investment | credit
  currency             text        not null default 'USD',
  current_balance      numeric,    -- native currency (USD)
  available_balance    numeric,
  current_balance_base numeric,    -- INR equivalent at last refresh
  raw                  jsonb,
  updated_at           timestamptz not null default now(),
  unique (connector_id, account_id)
);
create index if not exists idx_bank_balances_org on bank_account_balances (org_id);

-- Service-role only (mirrors ledger_categories / subscriptions): read via the
-- admin-gated Bank dashboard's service client; never client-exposed.
alter table bank_account_balances enable row level security;
