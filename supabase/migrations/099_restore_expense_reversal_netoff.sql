-- 099_restore_expense_reversal_netoff.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- REGRESSION FIX: expense refunds stopped setting off against their expense category.
--
-- A bank CREDIT tagged pnl_treatment='expense' is a REFUND/REVERSAL of a categorized
-- expense (e.g. THE MORNELL TRUST — ₹9.11L paid as Professional Services in Jun, then
-- ₹9.08L refunded in Jul, same category). It must net NEGATIVELY against that expense
-- category so the P&L shows the true net cost.
--
-- Migration 069 added exactly this branch to _dm_expense_m:
--     when r.type='credit' and r.ledger='bank' and r.pnl_treatment='expense' then -_dm_base(r)
-- Migration 085 (connector_pnl_enforcement) then REWROTE _dm_expense_m to add the
-- `conn_include_expense` gate and, in doing so, silently dropped the credit branch.
-- Since 085, refund credits contribute 0 instead of −amount → refunds no longer set
-- off (the drill still showed them as negative, so the drill and the line total
-- disagreed — the symptom the user reported).
--
-- This restores the credit branch while keeping 085's connector gate and the debit
-- logic byte-for-byte. The credit branch is guarded on status (a pending/failed
-- refund must not net early) and on conn_include_expense (a connector whose expenses
-- are excluded must not have its refunds net either). _dm_expense_m feeds BOTH the
-- dashboard expense rollup (068) and the P&L category rollup (073), so this fixes the
-- set-off everywhere at once.
--
-- Per the reconciliation convention (migration 098): a shared-helper change MUST end
-- with `select rebuild_all_rollups();` so the stored rollups are re-derived under the
-- corrected logic. SAFE to run as a normal migration.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function _dm_expense_m(r transactions) returns numeric language sql immutable as $$
  select case
    when _dm_excluded(r) then 0
    when not coalesce(r.conn_include_expense, true) then 0
    when r.type='debit' and ((r.ledger='bank' and r.pnl_treatment='expense')
         or (r.ledger='payments' and coalesce(r.category,'') not in ('refund','dispute','settlement'))) then _dm_base(r)
    when r.type='credit' and r.ledger='bank' and r.pnl_treatment='expense'
         and r.status in ('completed','refunded') then -_dm_base(r)
    else 0 end;
$$;

select rebuild_all_rollups();
