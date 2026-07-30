-- ============================================================
-- FILE: 037_mercury_connector.sql
-- Add the 'mercury' connector type (read-only Mercury Bank feed) — the expense/cash
-- (outflow) side that the payment gateways don't provide. Mirrors 027 (app_store).
--
-- ADD VALUE IF NOT EXISTS must run outside a txn that then references the new value,
-- so this migration only adds the enum value; dependent code deploys after.
-- ============================================================

ALTER TYPE connector_type ADD VALUE IF NOT EXISTS 'mercury';
