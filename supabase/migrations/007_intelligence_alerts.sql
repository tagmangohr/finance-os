-- ============================================================
-- FILE: 007_intelligence_alerts.sql
-- Intelligence Alerts — AI-generated financial insights & warnings
-- ============================================================

CREATE TYPE alert_type AS ENUM (
  'runway_warning',
  'collection_overdue',
  'burn_spike',
  'concentration_risk',
  'anomaly',
  'tax_due',
  'forecast'
);

CREATE TYPE alert_severity AS ENUM (
  'critical',
  'warning',
  'info'
);

CREATE TABLE intelligence_alerts (
  id         uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid           NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  type       alert_type     NOT NULL,
  severity   alert_severity NOT NULL,
  title      text           NOT NULL,
  message    text           NOT NULL,
  -- Arbitrary structured payload for the UI (entity ids, amounts, etc.)
  data       jsonb          NOT NULL DEFAULT '{}',
  is_read    boolean        NOT NULL DEFAULT false,
  created_at timestamptz    NOT NULL DEFAULT now()
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX idx_alerts_org_id      ON intelligence_alerts (org_id);
CREATE INDEX idx_alerts_unread      ON intelligence_alerts (org_id, is_read) WHERE is_read = false;
CREATE INDEX idx_alerts_created_at  ON intelligence_alerts (org_id, created_at DESC);
CREATE INDEX idx_alerts_severity    ON intelligence_alerts (org_id, severity);

-- ── Row-Level Security ───────────────────────────────────────
ALTER TABLE intelligence_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alerts_org_members_all"
  ON intelligence_alerts
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
