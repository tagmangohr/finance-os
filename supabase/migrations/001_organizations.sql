-- ============================================================
-- FILE: 001_organizations.sql
-- Organizations — top-level multi-tenant boundary
-- ============================================================

CREATE TABLE organizations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  slug        text        NOT NULL UNIQUE,
  currency    text        NOT NULL DEFAULT 'INR',
  timezone    text        NOT NULL DEFAULT 'Asia/Kolkata',
  owner_id    uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Index ────────────────────────────────────────────────────
CREATE INDEX idx_organizations_owner_id ON organizations (owner_id);
CREATE INDEX idx_organizations_slug     ON organizations (slug);

-- ── Row-Level Security ───────────────────────────────────────
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Owner has full access to their own organization
CREATE POLICY "org_owner_all"
  ON organizations
  FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- ── updated_at trigger ───────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();
