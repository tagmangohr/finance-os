-- 098_reconcile_rollups.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY: the metric rollups (revenue, dashboard, P&L expense, revenue-by-gateway,
-- payments summary) are maintained INCREMENTALLY by per-row triggers (+NEW / −OLD).
-- That is fast, but it is only self-consistent if every write goes through the
-- trigger exactly once. A one-off reprocess/backfill that re-applied a subset of
-- rows' +NEW without a matching −OLD silently DOUBLED those days in the expense
-- rollups (rollup_pnl_cat_day + rollup_metrics_daily) — inflating historical
-- expenses ~2× and dragging Net Profit negative, while the raw data stayed correct.
-- The raw ledger is the source of truth; the rollup had drifted from it.
--
-- FIX (permanent, self-healing): a single reconciliation entry point that RE-DERIVES
-- every rollup from the raw transactions table (each rebuild_* TRUNCATEs then
-- recomputes inside one transaction, so it is atomic and idempotent). Run nightly
-- from the cron (see app/api/cron/nightly-sync), so any drift — from a future
-- backfill, a helper change, or a bug — is corrected within 24h and can NEVER
-- silently persist. Under normal operation the triggers keep the rollups exact and
-- this is a no-op; it exists purely as the safety net for the numbers.
--
-- CONVENTION (enforce in review): ANY migration that (re)defines a shared rollup
-- helper — _dm_gross / _dm_expense_m / _pnl_fee / _rev_* / _cf_* etc. — MUST end
-- with `select rebuild_all_rollups();`. Migration 091 changed income helpers without
-- rebuilding (benign only because income was unaffected here); this closes that hole.
--
-- SAFE TO RUN AS A NORMAL MIGRATION. The trailing `select rebuild_all_rollups();`
-- reconciles the rollups that weren't manually rebuilt during the incident
-- (revenue, revenue-by-gateway, payments summary) so ALL rollups are consistent.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function rebuild_all_rollups() returns void language plpgsql security definer as $$
begin
  set local statement_timeout = 0;
  -- Order is irrelevant (each is independent and truncates its own table), but keep
  -- revenue → dashboard → P&L → gateway → summary for readability.
  perform rebuild_metric_rollups();          -- 059: rollup_revenue_monthly / _currency / cashflow
  perform rebuild_dash_rollups();            -- 068: rollup_metrics_daily / rollup_customer_day
  perform rebuild_pnl_rollups();             -- 073: rollup_pnl_cat_day
  perform rebuild_revenue_gateway_rollups(); -- 080: rollup_revenue_gateway_day
  perform rebuild_txn_summary_rollup();      -- 096: rollup_txn_summary_day
end $$;

grant execute on function rebuild_all_rollups() to service_role;

select rebuild_all_rollups();
