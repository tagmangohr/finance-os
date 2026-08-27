-- 097_view_configs.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Per-org, shared "view" configuration for the flexible column/breakdown playground.
-- Phase 1 uses view_key='sales' (the Sales ledger); the same table will later hold
-- 'payments' etc. The `config` jsonb governs ONLY presentation of descriptive columns
-- pulled from each row's metadata.raw — which columns are visible, their order, a
-- display label, whether they act as a breakdown dimension, and a light type hint.
-- The load-bearing money fields (date / amount / direction / currency) are mapped at
-- connect time and are NOT touched here, so a view change can never affect the ledger
-- math.
--
-- Example config value (stored in the `config` column — this is JSON, not SQL):
--   {
--     "columns": [
--       { "key": "Payment name",  "label": "Customer", "visible": true,  "dimension": true,  "type": "text",   "order": 0 },
--       { "key": "Taxable Value", "label": "Amount",   "visible": true,  "dimension": false, "type": "number", "order": 1 }
--     ]
--   }
--
-- Security: config is written only through an access-checked API route (which verifies
-- the caller may access the org's Sales page) using the service client. The table is
-- RLS-on with no policy — not directly readable/writable by app users — mirroring the
-- locked-down posture of the other server-only data tables.
--
-- SAFE TO RUN AS A NORMAL MIGRATION (small DDL, runs inside a transaction).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists view_configs (
  org_id     uuid        not null,
  view_key   text        not null,          -- 'sales' (Phase 1), later 'payments', etc.
  config     jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (org_id, view_key)
);

alter table view_configs enable row level security;

-- Server-only: read/write via the access-checked API using the service client.
grant select, insert, update, delete on view_configs to service_role;
