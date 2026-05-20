-- ============================================================
-- FILE: 004_transactions.sql
-- Transactions — every financial movement across connectors
-- ============================================================

CREATE TYPE transaction_type AS ENUM (
  'credit',
  'debit'
);

CREATE TYPE transaction_status AS ENUM (
  'pending',
  'completed',
  'failed',
  'refunded'
);

CREATE TABLE transactions (
  id                   uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid               NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  connector_id         uuid               NOT NULL REFERENCES connectors (id) ON DELETE RESTRICT,
  -- Source system identifier (nullable — manual/CSV rows may not have one)
  external_id          text,
  type                 transaction_type   NOT NULL,
  amount               numeric            NOT NULL,
  currency             text               NOT NULL DEFAULT 'INR',
  category             text,
  -- 0.0 → 1.0 confidence of AI categorisation
  category_confidence  numeric            CHECK (category_confidence IS NULL OR (category_confidence >= 0 AND category_confidence <= 1)),
  counterparty_id      uuid               REFERENCES entities (id) ON DELETE SET NULL,
  counterparty_name    text,
  description          text,
  source               text               NOT NULL,
  status               transaction_status NOT NULL DEFAULT 'completed',
  transaction_date     date               NOT NULL,
  metadata             jsonb              NOT NULL DEFAULT '{}',
  created_at           timestamptz        NOT NULL DEFAULT now()
);

-- ── Unique constraint: no duplicate rows from the same connector ──
-- Partial index (WHERE external_id IS NOT NULL) acts as the uniqueness guard.
CREATE UNIQUE INDEX uq_transactions_org_connector_external
  ON transactions (org_id, connector_id, external_id)
  WHERE external_id IS NOT NULL;

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX idx_transactions_org_id           ON transactions (org_id);
CREATE INDEX idx_transactions_date             ON transactions (org_id, transaction_date DESC);
CREATE INDEX idx_transactions_type             ON transactions (org_id, type);
CREATE INDEX idx_transactions_status           ON transactions (org_id, status);
CREATE INDEX idx_transactions_counterparty     ON transactions (counterparty_id) WHERE counterparty_id IS NOT NULL;
CREATE INDEX idx_transactions_connector        ON transactions (connector_id);
-- Composite for monthly analytics queries
CREATE INDEX idx_transactions_org_date_type    ON transactions (org_id, transaction_date DESC, type);

-- ── Row-Level Security ───────────────────────────────────────
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transactions_org_members_all"
  ON transactions
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
