-- ============================================================
-- FILE: 009_new_connectors.sql
-- Add Cashfree, PayU, Paytm, Easebuzz to connector_type enum
-- PostgreSQL 14+ allows ADD VALUE inside transactions.
-- Supabase runs PG ≥ 15 so this is safe.
-- ============================================================

ALTER TYPE connector_type ADD VALUE IF NOT EXISTS 'cashfree';
ALTER TYPE connector_type ADD VALUE IF NOT EXISTS 'payu';
ALTER TYPE connector_type ADD VALUE IF NOT EXISTS 'paytm';
ALTER TYPE connector_type ADD VALUE IF NOT EXISTS 'easebuzz';
