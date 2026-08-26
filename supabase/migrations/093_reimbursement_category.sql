-- 093_reimbursement_category.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Add "Reimbursement" as an EXPENSE category — money paid back to employees/
-- founders for out-of-pocket business spend (travel, meals, supplies bought on a
-- personal card, etc.). Sort 95 places it right after Travel (90), which
-- reimbursements most often cover.
--
-- Data-driven, same as ai_tool (086) / creator_payout (083): appears in the Bank
-- categorizer dropdown automatically (getCategories reads ledger_categories) and,
-- when assigned, sets pnl_treatment='expense' → flows into the P&L as a plain
-- operating expense ("Other Operating"). Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

insert into ledger_categories (org_id, slug, label, treatment, flow, sort, is_system) values
  (null, 'reimbursement', 'Reimbursement', 'expense', 'out', 95, true)
on conflict do nothing;
