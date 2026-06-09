-- ============================================================
-- FILE: 014_org_members.sql
-- Team / multi-user access control per organisation
-- ============================================================
-- Each org_member row represents one invited user.
-- Owner is NOT stored here — they get implicit full access
-- via the existing organizations.owner_id column.
--
-- page_access: array of page slugs the member can visit.
--   Possible values: dashboard, revenue, cashflow, collections,
--                    intelligence, connectors, data
-- role 'admin'  → can manage team + sees all pages regardless of page_access
-- role 'viewer' → only pages listed in page_access
--
-- Invite flow:
--   1. Owner invites email → row inserted with status='pending', user_id=NULL
--   2. Invitee signs up / logs in with the same email
--   3. Dashboard layout detects the pending invite, activates it
--      (sets user_id = auth.uid(), status = 'active')
-- ============================================================

CREATE TABLE org_members (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Null until the invited user actually signs in and the invite is activated
  user_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_email text        NOT NULL,
  role          text        NOT NULL DEFAULT 'viewer'
                CHECK (role IN ('admin', 'viewer')),
  -- Array of page slugs; ignored when role = 'admin'
  page_access   text[]      NOT NULL DEFAULT ARRAY['dashboard','revenue','cashflow','collections']::text[],
  status        text        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'active', 'revoked')),
  invited_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Each email can only be invited once per org
  UNIQUE(org_id, invited_email)
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX idx_org_members_org_id  ON org_members (org_id);
CREATE INDEX idx_org_members_user_id ON org_members (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_org_members_email   ON org_members (invited_email);

-- ── Row-Level Security ────────────────────────────────────────
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

-- Org owner has full control over their org's member list
CREATE POLICY "org_owner_manages_members"
  ON org_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM organizations
      WHERE id = org_members.org_id AND owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM organizations
      WHERE id = org_members.org_id AND owner_id = auth.uid()
    )
  );

-- Members can read their own record so they know their own permissions
CREATE POLICY "member_reads_own"
  ON org_members FOR SELECT
  USING (user_id = auth.uid());

-- ── Allow active members to read their org ───────────────────
-- (The existing org policy only allows the owner; this extends it)
CREATE POLICY "org_active_member_reads"
  ON organizations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM org_members
      WHERE org_id  = organizations.id
        AND user_id = auth.uid()
        AND status  = 'active'
    )
  );

-- ── updated_at trigger ────────────────────────────────────────
CREATE TRIGGER set_org_members_updated_at
  BEFORE UPDATE ON org_members
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();
