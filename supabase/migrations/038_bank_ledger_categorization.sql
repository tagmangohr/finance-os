-- ============================================================
-- FILE: 038_bank_ledger_categorization.sql
-- Bank ledger + expense-categorization layer.
--
-- Adds a `ledger` discriminator ('payments' = PG/gateway money, 'bank' = bank-
-- feed money like Mercury) + a P&L `pnl_treatment` on transactions, the category
-- taxonomy (ledger_categories, with per-category P&L treatment), and the
-- counterparty-memory rules (category_rules) that make categorization sticky.
--
-- Why one ledger, not a separate table: money stays a single fact table so the
-- existing revenue/expense rollups keep working; bank rows are simply tagged and
-- filtered. The row-level firewall (revenue never counts bank inflows) lives in
-- the views (migration 039) + the app query builders.
--
-- Privacy: the two new tables are SERVICE-ROLE ONLY (RLS enabled, zero client
-- policies — the same posture as subscriptions/webhook_events). Bank vendor /
-- payroll detail is read only through the admin-gated Bank dashboard via the
-- service client, never through the anon/authenticated API. (transactions itself
-- is already owner-only RLS, so bank rows there are not client-exposed either.)
-- ============================================================

-- ── 1. transactions: ledger + P&L treatment + categorization provenance ──────
alter table transactions
  add column if not exists ledger         text not null default 'payments',
  add column if not exists pnl_treatment  text,
  add column if not exists category_source text;

alter table transactions drop constraint if exists transactions_ledger_check;
alter table transactions add  constraint transactions_ledger_check
  check (ledger in ('payments', 'bank'));

alter table transactions drop constraint if exists transactions_pnl_treatment_check;
alter table transactions add  constraint transactions_pnl_treatment_check
  check (pnl_treatment is null or pnl_treatment in ('expense', 'income', 'excluded', 'uncategorized'));

alter table transactions drop constraint if exists transactions_category_source_check;
alter table transactions add  constraint transactions_category_source_check
  check (category_source is null or category_source in ('manual', 'rule', 'ai', 'system'));

-- Bank-ledger working set (list + categorize) and treatment rollups.
create index if not exists idx_transactions_bank
  on transactions (org_id, transaction_date desc)
  where ledger = 'bank';
create index if not exists idx_transactions_bank_treatment
  on transactions (org_id, pnl_treatment)
  where ledger = 'bank';

-- ── 2. ledger_categories: the taxonomy + P&L treatment ───────────────────────
-- org_id NULL = system default (shared by every org). A row with a real org_id
-- adds an org-specific category. `treatment` decides how a categorized txn hits
-- the P&L:
--   expense       → operating expense (Expense Breakdown, burn, net P&L)
--   income        → other income (real revenue NOT via a PG — client wires, interest)
--   excluded      → cash moved but NOT P&L (PG settlements already counted,
--                   internal transfers, owner draws, loan/financing, capital)
--   uncategorized → counts as nothing until a human/AI classifies it
-- `flow` restricts which side (credit/in vs debit/out) the category applies to.
create table if not exists ledger_categories (
  id         uuid        primary key default gen_random_uuid(),
  org_id     uuid        references organizations (id) on delete cascade,
  slug       text        not null,
  label      text        not null,
  treatment  text        not null check (treatment in ('expense', 'income', 'excluded', 'uncategorized')),
  flow       text        not null default 'out' check (flow in ('in', 'out', 'both')),
  sort       int         not null default 100,
  is_system  boolean     not null default false,
  created_at timestamptz not null default now()
);

-- Unique per (org, slug); system defaults (NULL org) collapse to a sentinel so
-- they are unique among themselves and never collide with an org's custom slug.
create unique index if not exists uq_ledger_categories_org_slug
  on ledger_categories (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);

insert into ledger_categories (org_id, slug, label, treatment, flow, sort, is_system) values
  -- Expenses (debit / out)
  (null, 'payroll',           'Payroll',                       'expense',       'out',   10, true),
  (null, 'contractors',       'Contractors & Freelancers',     'expense',       'out',   20, true),
  (null, 'cloud_infra',       'Cloud & Infrastructure',        'expense',       'out',   30, true),
  (null, 'software',          'Software & SaaS',               'expense',       'out',   40, true),
  (null, 'marketing',         'Marketing & Advertising',       'expense',       'out',   50, true),
  (null, 'payment_fees',      'Payment & Processing Fees',     'expense',       'out',   60, true),
  (null, 'professional',      'Professional Services',         'expense',       'out',   70, true),
  (null, 'office',            'Office, Rent & Utilities',      'expense',       'out',   80, true),
  (null, 'travel',            'Travel',                        'expense',       'out',   90, true),
  (null, 'taxes',             'Taxes',                         'expense',       'out',  100, true),
  (null, 'bank_charges',      'Bank Charges',                  'expense',       'out',  110, true),
  (null, 'vendor_payment',    'Vendor Payment',                'expense',       'out',  120, true),
  (null, 'other_expense',     'Other Expense',                 'expense',       'out',  130, true),
  -- Other income (credit / in) — real revenue NOT already counted by a PG
  (null, 'customer_payment',  'Customer / Invoice Payment',    'income',        'in',   200, true),
  (null, 'interest_income',   'Interest Income',               'income',        'in',   210, true),
  (null, 'other_income',      'Other Income',                  'income',        'in',   220, true),
  -- Excluded — cash moved but not P&L
  (null, 'pg_settlement',     'PG Settlement (already counted)', 'excluded',    'in',   300, true),
  (null, 'internal_transfer', 'Internal Transfer',             'excluded',      'both', 310, true),
  (null, 'owner_draw',        'Owner Draw / Distribution',     'excluded',      'out',  320, true),
  (null, 'financing',         'Loan / Financing',              'excluded',      'both', 330, true),
  (null, 'capital',           'Capital / Investment',          'excluded',      'in',   340, true),
  -- Default until classified
  (null, 'uncategorized',     'Uncategorized',                 'uncategorized', 'both', 900, true)
on conflict do nothing;

-- ── 3. category_rules: counterparty memory (deterministic layer) ─────────────
-- Every manual categorization writes/updates a rule here so the SAME counterparty
-- auto-applies to its past + future transactions. Seeded with high-precision
-- system rules (org_id NULL) — most importantly PG-settlement detection, the
-- double-count firewall for bank inflows.
create table if not exists category_rules (
  id            uuid        primary key default gen_random_uuid(),
  org_id        uuid        references organizations (id) on delete cascade,
  match_field   text        not null check (match_field in ('counterparty', 'description', 'source')),
  match_type    text        not null default 'contains' check (match_type in ('exact', 'contains')),
  match_value   text        not null,
  category_slug text        not null,
  priority      int         not null default 100,
  source        text        not null default 'manual' check (source in ('seed', 'manual')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists uq_category_rules_org_field_value
  on category_rules (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), match_field, match_type, lower(match_value));
create index if not exists idx_category_rules_org on category_rules (org_id);

insert into category_rules (org_id, match_field, match_type, match_value, category_slug, priority, source) values
  -- PG settlements landing in the bank = money already counted as PG revenue.
  (null, 'counterparty', 'contains', 'stripe',              'pg_settlement', 10, 'seed'),
  (null, 'counterparty', 'contains', 'razorpay',            'pg_settlement', 10, 'seed'),
  (null, 'counterparty', 'contains', 'cashfree',            'pg_settlement', 10, 'seed'),
  (null, 'counterparty', 'contains', 'payu',                'pg_settlement', 10, 'seed'),
  (null, 'description',  'contains', 'stripe payout',       'pg_settlement', 10, 'seed'),
  -- A few high-precision vendor rules; the AI layer handles the long tail.
  (null, 'counterparty', 'contains', 'amazon web services', 'cloud_infra',  20, 'seed'),
  (null, 'counterparty', 'contains', 'google cloud',        'cloud_infra',  20, 'seed'),
  (null, 'counterparty', 'contains', 'vercel',              'cloud_infra',  20, 'seed'),
  (null, 'counterparty', 'contains', 'github',              'software',     20, 'seed'),
  (null, 'counterparty', 'contains', 'openai',              'software',     20, 'seed'),
  (null, 'counterparty', 'contains', 'anthropic',           'software',     20, 'seed')
on conflict do nothing;

-- ── 4. RLS: service-role only (mirrors subscriptions / webhook_events) ───────
-- RLS enabled + ZERO policies = denied to anon/authenticated, service role
-- bypasses. Reads flow through the admin-gated Bank dashboard's service client.
alter table ledger_categories enable row level security;
alter table category_rules    enable row level security;
