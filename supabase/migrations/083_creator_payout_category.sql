-- 083_creator_payout_category.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Add "Creator Payout" as an EXCLUDED category.
--
-- Creator payouts are pass-through money (paying creators their share), NOT the
-- company's own P&L expense. They flow from the BANK feeds (Mercury / Brex / other
-- bank connectors), so the 'excluded' treatment is sufficient: a bank row tagged
-- creator_payout gets pnl_treatment='excluded', which _dm_expense_m (069) does not
-- count (it only counts bank debits with pnl_treatment='expense'). No rollup-helper
-- change is needed. Sort 350 places it after the other excluded categories
-- (pg_settlement 300 … capital 340).
--
-- Idempotent: on conflict do nothing, so re-running is safe. Appears automatically
-- in the Bank categorizer dropdown (getCategories reads ledger_categories) and in
-- treatmentMap (slug → 'excluded').
-- ─────────────────────────────────────────────────────────────────────────────

insert into ledger_categories (org_id, slug, label, treatment, flow, sort, is_system) values
  (null, 'creator_payout', 'Creator Payout', 'excluded', 'out', 350, true)
on conflict do nothing;
