-- ============================================================
-- FILE: 002_connectors.sql
-- Connectors — data source integrations per organization
-- ============================================================

CREATE TYPE connector_type AS ENUM (
  'razorpay',
  'stripe',
  'zoho',
  'quickbooks',
  'tally',
  'csv',
  'bank_statement'
);

CREATE TYPE connector_status AS ENUM (
  'active',
  'inactive',
  'error'
);

CREATE TABLE connectors (
  id             uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid             NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  type           connector_type   NOT NULL,
  name           text             NOT NULL,
  status         connector_status NOT NULL DEFAULT 'inactive',
  config         jsonb            NOT NULL DEFAULT '{}',
  last_synced_at timestamptz,
  created_at     timestamptz      NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX idx_connectors_org_id ON connectors (org_id);
CREATE INDEX idx_connectors_type   ON connectors (org_id, type);

-- ── Row-Level Security ───────────────────────────────────────
ALTER TABLE connectors ENABLE ROW LEVEL SECURITY;

-- Org members (owner for now) can access their connectors
CREATE POLICY "connectors_org_members_all"
  ON connectors
  FOR ALL
  USING (
    org_id IN (
      SELECT id FROM organizations WHERE owner_id = auth.uid()
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT id FROM organizations WHERE owner_id = auth.uid()
    )
  );
