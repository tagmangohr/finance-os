-- ============================================================
-- FILE: 003_entities.sql
-- Entities — customers and vendors per organization
-- ============================================================

CREATE TYPE entity_type AS ENUM (
  'customer',
  'vendor'
);

CREATE TABLE entities (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  type                  entity_type NOT NULL,
  name                  text        NOT NULL,
  email                 text,
  phone                 text,
  gstin                 text,
  total_revenue         numeric     NOT NULL DEFAULT 0,
  total_paid            numeric     NOT NULL DEFAULT 0,
  outstanding_amount    numeric     NOT NULL DEFAULT 0,
  last_transaction_date date,
  avg_payment_days      numeric,
  -- Risk score 0 (low) – 100 (high); enforced via check constraint
  risk_score            numeric     CHECK (risk_score IS NULL OR (risk_score >= 0 AND risk_score <= 100)),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX idx_entities_org_id      ON entities (org_id);
CREATE INDEX idx_entities_org_type    ON entities (org_id, type);
CREATE INDEX idx_entities_org_email   ON entities (org_id, email) WHERE email IS NOT NULL;
CREATE INDEX idx_entities_risk_score  ON entities (org_id, risk_score DESC NULLS LAST);

-- ── Row-Level Security ───────────────────────────────────────
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "entities_org_members_all"
  ON entities
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

-- ── updated_at trigger ───────────────────────────────────────
CREATE TRIGGER set_entities_updated_at
  BEFORE UPDATE ON entities
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();
