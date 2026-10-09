-- 131_expense_debit_status_gate.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- BUG FIX: failed / pending debits were counted as EXPENSES in the P&L.
--
-- _dm_expense_m (and its twin _dm_outflow_l) gate the CREDIT (reversal) branch on
-- status, but their DEBIT branch had NO status gate — so a bank-expense debit was
-- counted regardless of status, including `failed` (a bounced/declined charge —
-- no money moved) and `pending` (in-flight, not yet settled). Every sibling that
-- sums money gates this (_dm_gross, _rev_contrib, _cf_out, _pnl_fee, the
-- bank_overview_agg RPC, vw_metrics_monthly, and even this helper's own credit
-- branch all use `status in ('completed','refunded')`). The gate was dropped when
-- migration 085 rewrote these two helpers; this restores it.
--
-- SYMPTOM (Fiesta, Sep 2026): "Other Expense · RAZ*Ideope Media" showed ₹91,703
-- across 8 txns (7 failed + 1 completed, each ₹11,462.89) when the real expense is
-- the single completed ₹11,463. The line-items rollup (115) sums _dm_expense_m, so
-- both its amount AND its count inherited the inflation — while the drill route and
-- pnl_drill_groups RPC already gate status, which is why the group header and its
-- own drill-down disagreed. Historical overstatement across all categories:
-- ~₹34.9L failed + ~₹0.9L pending ≈ ₹35.8L (Net Profit was understated by that).
--
-- SURFACES FIXED (all read these two helpers):
--   • rollup_pnl_cat_day   (073) → P&L category lines, Total Opex, Net Profit, CM %
--   • rollup_pnl_lineitem  (115) → P&L vendor/gateway sub-rows AND their txn counts
--   • rollup_metrics_daily (068) → expense_m / outflow_l measures
-- Already-gated surfaces (bank_overview_agg, vw_metrics_monthly, _cf_*, the drill
-- route + pnl_drill_groups RPC) are unchanged and will now TIE to the P&L line.
--
-- CHANGE: add `and r.status in ('completed','refunded')` to the DEBIT branch of
-- both helpers. Everything else — the connector gate, the _dm_expense_m credit
-- (reversal) branch, and _dm_outflow_l's wider category rule (it keeps 'refund',
-- excluding only 'dispute'/'settlement') — is preserved byte-for-byte.
--
-- A pending debit that later settles flips to status='completed' and the rollup
-- trigger re-applies it, so accrual stays correct (expense recognized when borne).
--
-- INVARIANT (migration 098): a shared-helper change MUST end by rebuilding every
-- rollup from raw, so the cached values are re-derived under the corrected logic.
-- SAFE to run as a normal migration.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function _dm_expense_m(r transactions) returns numeric language sql immutable as $$
  select case
    when _dm_excluded(r) then 0
    when not coalesce(r.conn_include_expense, true) then 0
    when r.type='debit' and r.status in ('completed','refunded')
         and ((r.ledger='bank' and r.pnl_treatment='expense')
           or (r.ledger='payments' and coalesce(r.category,'') not in ('refund','dispute','settlement'))) then _dm_base(r)
    when r.type='credit' and r.ledger='bank' and r.pnl_treatment='expense'
         and r.status in ('completed','refunded') then -_dm_base(r)
    else 0 end;
$$;

-- _dm_outflow_l keeps its ORIGINAL 085 structure verbatim (incl. the `conn_include_expense`
-- gate form, where a NULL flag excludes) — ONLY the status condition is inserted. Its
-- category rule stays wider than _dm_expense_m's (excludes 'dispute'/'settlement', keeps
-- 'refund'), unchanged.
create or replace function _dm_outflow_l(r transactions) returns numeric language sql immutable as $$
  select case when _dm_excluded(r) then 0 when r.conn_include_expense and r.type='debit' and r.status in ('completed','refunded') and ((r.ledger='bank' and r.pnl_treatment='expense') or (r.ledger='payments' and coalesce(r.category,'') not in ('dispute','settlement'))) then _dm_base(r) else 0 end; $$;

-- ── Rule-e fix: close the statement-timeout gap left by migration 100 ────────
-- Migration 100 pinned statement_timeout='600s' on the heavy rebuilds, but three
-- were missed: rebuild_fees_gateway_rollups + rebuild_lineitem rollups were added
-- LATER (115) and rely on an in-body `set local statement_timeout=0` that does not
-- reliably take effect under PostgREST (observed: fees_gateway cancelled at 8.4s),
-- and rebuild_dash_rollups / rebuild_metric_rollups never had the guard at all.
-- A function-level setting is authoritative, so pin it on all three. (No-op when
-- called from rebuild_all_rollups, which already sets statement_timeout=0.)
alter function rebuild_fees_gateway_rollups() set statement_timeout = '600s';
alter function rebuild_dash_rollups()         set statement_timeout = '600s';
alter function rebuild_metric_rollups()       set statement_timeout = '600s';

select rebuild_all_rollups();
