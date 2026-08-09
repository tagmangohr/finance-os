-- 053_member_search_only.sql
-- Per-member "search-only Payments" access: when true, the member sees the
-- Payments page as a lookup tool (no rows until they search; enforced
-- server-side). Built for support / calling teams who should resolve a specific
-- customer's payment without browsing the entire book.
alter table org_members
  add column if not exists payments_search_only boolean not null default false;

comment on column org_members.payments_search_only is
  'When true, this member sees Payments as a search-only lookup (no rows until they search; enforced server-side). For support/calling teams.';
