-- 084_connector_pnl_toggles.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Per-connector control over whether a connector's money counts in the P&L and
-- dashboard/analytics calculations. Two independent switches, both DEFAULT TRUE so
-- existing behavior is unchanged until a toggle is flipped (every connector counts,
-- exactly as today).
--
--   include_income  = false → this connector's REVENUE is dropped everywhere:
--                             PG captures (gross), bank income, AND its refunds +
--                             chargebacks (contra-revenue follows revenue, else you'd
--                             subtract refunds for revenue you never counted).
--   include_expense = false → this connector's EXPENSE is dropped everywhere:
--                             expense debits (bank + payments) AND its PG fees.
--
-- Enforcement lives in migration 085 (connector-dimension rollups + read-time join),
-- so flipping a toggle updates every page instantly with no rebuild. This migration
-- only adds the storage — safe to apply before 085 and before the dependent code
-- deploys (columns are inert until 085 reads them).
--
-- Same posture as connectors.capture_events (071): a plain boolean column with a
-- default, validated + PATCHed via /api/connectors/manage.
-- ─────────────────────────────────────────────────────────────────────────────

alter table connectors add column if not exists include_income  boolean not null default true;
alter table connectors add column if not exists include_expense boolean not null default true;

comment on column connectors.include_income  is
  'When false, this connector''s revenue (PG captures + bank income) and its refunds/chargebacks are excluded from all P&L/dashboard/analytics metrics. Default true.';
comment on column connectors.include_expense is
  'When false, this connector''s expenses (bank + payments debits) and PG fees are excluded from all P&L/dashboard/analytics metrics. Default true.';
