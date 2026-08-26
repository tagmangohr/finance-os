-- 082_brex_connector.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Register the Brex connector type.
--
-- connectors.type is the `connector_type` enum (migration 002). A connector row
-- can't be inserted with type='brex' until the enum knows that value, so add it.
-- ADD VALUE is idempotent with IF NOT EXISTS and must run OUTSIDE a txn block —
-- the Supabase SQL editor runs top-level statements that way, so this is safe.
-- No table/column changes: Brex reuses the existing bank-ledger columns
-- (ledger='bank', account_type, card_last4/holder) exactly like Mercury.
-- ─────────────────────────────────────────────────────────────────────────────

alter type connector_type add value if not exists 'brex';
