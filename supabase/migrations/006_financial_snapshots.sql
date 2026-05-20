-- ============================================================
-- FILE: 006_financial_snapshots.sql
-- Financial Snapshots — daily point-in-time financial state
-- ============================================================

CREATE TABLE financial_snapshots (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  snapshot_date        date        NOT NULL,
  -- Cash & burn
  cash_balance         numeric     NOT NULL DEFAULT 0,
  total_revenue_mtd    numeric     NOT NULL DEFAULT 0,
  total_expenses_mtd   numeric     NOT NULL DEFAULT 0,
  burn_rate            numeric     NOT NULL DEFAULT 0,   -- average monthly cash outflow
  runway_days          integer     NOT NULL DEFAULT 0,   -- days of cash remaining at current burn
  -- SaaS / recurring metrics
  mrr                  numeric     NOT NULL DEFAULT 0,
  arr                  numeric     NOT NULL DEFAULT 0,
  -- Working capital
  accounts_receivable  numeric     NOT NULL DEFAULT 0,
  accounts_payable     numeric     NOT NULL DEFAULT 0,
  -- Collection efficiency: 0–1 (or 0–100 %)
  collection_rate      numeric     NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_financial_snapshots_org_date UNIQUE (org_id, snapshot_date)
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX idx_financial_snapshots_org_id ON financial_snapshots (org_id);
CREATE INDEX idx_financial_snapshots_date   ON financial_snapshots (org_id, snapshot_date DESC);

-- ── Row-Level Security ───────────────────────────────────────
ALTER TABLE financial_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "snapshots_org_members_all"
  ON financial_snapshots
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
