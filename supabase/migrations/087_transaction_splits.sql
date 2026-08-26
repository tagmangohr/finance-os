-- 087_transaction_splits.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Split a bank transaction into multiple parts, each categorized differently.
--
-- Model (child rows, so the existing rollups/drills/categorizer keep working with
-- ZERO changes — a child is just an ordinary categorized bank transaction):
--   • The ORIGINAL row becomes a "split parent": is_split_parent = true and
--     pnl_treatment = 'excluded', so it contributes NOTHING to P&L / cashflow /
--     expense rollups (no double-count). It's hidden from the Bank list (children
--     shown instead) and skipped by the Bank overview aggregate.
--   • N CHILD rows carry a portion of the amount + their own category, linked via
--     split_parent_id, summing EXACTLY to the parent. Children flow through every
--     rollup naturally (they're real bank rows). Synthetic external_id
--     (<parent>__split_<n>) so re-sync never dupes/deletes them; re-sync also never
--     touches category/pnl_treatment or these split columns, so a split survives.
--
-- No schema change to any rollup: the parent's 'excluded' treatment removes it, the
-- children's real categories add back the same total. Idempotent (add column if not
-- exists). ON DELETE CASCADE so deleting a parent removes its children.
-- ─────────────────────────────────────────────────────────────────────────────

alter table transactions add column if not exists is_split_parent boolean not null default false;
alter table transactions add column if not exists split_parent_id  uuid references transactions(id) on delete cascade;

-- Fast lookup of a parent's children (and to filter parents out of the list).
create index if not exists idx_transactions_split_children
  on transactions (split_parent_id) where split_parent_id is not null;
create index if not exists idx_transactions_split_parents
  on transactions (org_id) where is_split_parent = true;
