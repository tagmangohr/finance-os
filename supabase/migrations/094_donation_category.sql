-- 094_donation_category.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Add "Donation" as an EXPENSE category — charitable / CSR donations and
-- contributions. Sort 128 places it just before "Other Expense" (130).
--
-- Data-driven, same as reimbursement (093) / ai_tool (086): appears in the Bank
-- categorizer dropdown + bulk-tag picker automatically (getCategories reads
-- ledger_categories) and sets pnl_treatment='expense' when assigned → flows into
-- the P&L as a plain operating expense ("Other Operating"). Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

insert into ledger_categories (org_id, slug, label, treatment, flow, sort, is_system) values
  (null, 'donation', 'Donation', 'expense', 'out', 128, true)
on conflict do nothing;
