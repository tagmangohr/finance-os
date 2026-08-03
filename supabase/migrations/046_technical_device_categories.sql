-- ============================================================
-- FILE: 046_technical_device_categories.sql
-- Add two manual expense categories to the dropdown:
--   • Technical Expense  — technical/engineering spend that isn't cloud or SaaS
--                          (APIs, domains, certs, tooling, one-off dev services)
--   • Device Expense     — hardware bought for the team (laptops, phones,
--                          monitors, peripherals, accessories)
--
-- Data-only: the category dropdown, AI categorizer, and P&L reports all read the
-- ledger_categories taxonomy at runtime, so these appear immediately after apply.
-- No auto-rules are seeded — both are judgment calls assigned manually, and a
-- greedy vendor rule (e.g. "Amazon") would misclassify unrelated spend. Existing
-- rows are left untouched.
-- ============================================================

insert into ledger_categories (org_id, slug, label, treatment, flow, sort, is_system) values
  (null, 'technical_expense', 'Technical Expense', 'expense', 'out', 44, true),
  (null, 'device_expense',    'Device Expense',    'expense', 'out', 46, true)
on conflict do nothing;
