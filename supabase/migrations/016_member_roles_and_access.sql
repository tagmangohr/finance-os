-- ============================================================
-- FILE: 016_member_roles_and_access.sql
-- Two things needed for real team access:
--   1. A third role, 'manager' (Viewer < Manager < Admin).
--   2. Member READ access to the org's data tables. Until now every data
--      table's RLS was owner-only, so an invited member would see EMPTY
--      dashboards. We grant active members SELECT via the existing
--      auth_is_active_member() SECURITY DEFINER helper (migration 015), which
--      avoids the cross-table policy recursion that plain subqueries cause.
--
-- Writes are unaffected: connector/sync/etc. mutations run through the API's
-- service-role client AFTER app-level authorization (owner/admin/manager), so
-- these member policies are intentionally SELECT-only (least privilege).
-- ============================================================

-- ── 1. Allow the 'manager' role ──────────────────────────────────────────────
ALTER TABLE org_members DROP CONSTRAINT IF EXISTS org_members_role_check;
ALTER TABLE org_members
  ADD CONSTRAINT org_members_role_check CHECK (role IN ('admin', 'manager', 'viewer'));

-- ── 2. Member READ policies on data tables ───────────────────────────────────
-- Additive: the existing owner-only "*_org_members_all" FOR ALL policies remain,
-- so owners keep full access; these add SELECT for active members. Postgres ORs
-- permissive policies together.

DROP POLICY IF EXISTS "connectors_member_reads" ON connectors;
CREATE POLICY "connectors_member_reads" ON connectors
  FOR SELECT USING (auth_is_active_member(org_id));

DROP POLICY IF EXISTS "transactions_member_reads" ON transactions;
CREATE POLICY "transactions_member_reads" ON transactions
  FOR SELECT USING (auth_is_active_member(org_id));

DROP POLICY IF EXISTS "entities_member_reads" ON entities;
CREATE POLICY "entities_member_reads" ON entities
  FOR SELECT USING (auth_is_active_member(org_id));

DROP POLICY IF EXISTS "invoices_member_reads" ON invoices;
CREATE POLICY "invoices_member_reads" ON invoices
  FOR SELECT USING (auth_is_active_member(org_id));

DROP POLICY IF EXISTS "financial_snapshots_member_reads" ON financial_snapshots;
CREATE POLICY "financial_snapshots_member_reads" ON financial_snapshots
  FOR SELECT USING (auth_is_active_member(org_id));

DROP POLICY IF EXISTS "intelligence_alerts_member_reads" ON intelligence_alerts;
CREATE POLICY "intelligence_alerts_member_reads" ON intelligence_alerts
  FOR SELECT USING (auth_is_active_member(org_id));

DROP POLICY IF EXISTS "drive_connections_member_reads" ON drive_connections;
CREATE POLICY "drive_connections_member_reads" ON drive_connections
  FOR SELECT USING (auth_is_active_member(org_id));

DROP POLICY IF EXISTS "drive_folders_member_reads" ON drive_folders;
CREATE POLICY "drive_folders_member_reads" ON drive_folders
  FOR SELECT USING (auth_is_active_member(org_id));

DROP POLICY IF EXISTS "drive_files_member_reads" ON drive_files;
CREATE POLICY "drive_files_member_reads" ON drive_files
  FOR SELECT USING (auth_is_active_member(org_id));
