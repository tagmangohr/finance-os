-- ============================================================
-- FILE: 015_fix_rls_recursion.sql
-- Fix infinite recursion in RLS policies introduced in 014
-- ============================================================
-- Root cause:
--   "org_active_member_reads" on organizations queries org_members
--   "org_owner_manages_members" on org_members queries organizations
--   → circular reference → PostgreSQL error "infinite recursion
--     detected in policy for relation organizations"
--
-- Fix: two SECURITY DEFINER helper functions that break the cycle.
--   SECURITY DEFINER bypasses RLS on the queried table, stopping
--   the infinite recursion while still checking auth.uid().
-- ============================================================

-- ── Helper: does the current user own this org? ──────────────
-- Used by org_members policies (replaces direct query to organizations)
CREATE OR REPLACE FUNCTION auth_is_org_owner(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = p_org_id
      AND owner_id = auth.uid()
  );
$$;

-- ── Helper: is the current user an active member of this org? ──
-- Used by organizations policies (replaces direct query to org_members)
CREATE OR REPLACE FUNCTION auth_is_active_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id  = p_org_id
      AND user_id = auth.uid()
      AND status  = 'active'
  );
$$;

-- ── Recreate the offending policies using the helper functions ──

-- org_members: owner management
DROP POLICY IF EXISTS "org_owner_manages_members" ON org_members;
CREATE POLICY "org_owner_manages_members"
  ON org_members FOR ALL
  USING     (auth_is_org_owner(org_id))
  WITH CHECK(auth_is_org_owner(org_id));

-- organizations: active-member read access
DROP POLICY IF EXISTS "org_active_member_reads" ON organizations;
CREATE POLICY "org_active_member_reads"
  ON organizations FOR SELECT
  USING (auth_is_active_member(id));
