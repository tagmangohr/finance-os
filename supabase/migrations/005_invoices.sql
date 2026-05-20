-- ============================================================
-- FILE: 005_invoices.sql
-- Invoices — receivables and payables lifecycle
-- ============================================================

CREATE TYPE invoice_status AS ENUM (
  'draft',
  'sent',
  'paid',
  'overdue',
  'cancelled'
);

CREATE TABLE invoices (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid           NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  entity_id      uuid           NOT NULL REFERENCES entities (id) ON DELETE RESTRICT,
  connector_id   uuid           REFERENCES connectors (id) ON DELETE SET NULL,
  external_id    text,
  invoice_number text           NOT NULL,
  amount         numeric        NOT NULL,
  currency       text           NOT NULL DEFAULT 'INR',
  status         invoice_status NOT NULL DEFAULT 'draft',
  due_date       date           NOT NULL,
  paid_date      date,
  -- Structured line items: [{ description, quantity, unit_price, amount, tax_rate }]
  line_items     jsonb          NOT NULL DEFAULT '[]',
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now(),

  -- A paid invoice must have a paid_date
  CONSTRAINT chk_paid_date CHECK (
    status <> 'paid' OR paid_date IS NOT NULL
  )
);

-- ── Unique constraint: no duplicate invoice numbers per org ──
CREATE UNIQUE INDEX uq_invoices_org_number
  ON invoices (org_id, invoice_number);

-- Deduplicate connector imports
CREATE UNIQUE INDEX uq_invoices_org_connector_external
  ON invoices (org_id, connector_id, external_id)
  WHERE connector_id IS NOT NULL AND external_id IS NOT NULL;

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX idx_invoices_org_id     ON invoices (org_id);
CREATE INDEX idx_invoices_entity_id  ON invoices (entity_id);
CREATE INDEX idx_invoices_status     ON invoices (org_id, status);
CREATE INDEX idx_invoices_due_date   ON invoices (org_id, due_date DESC);

-- ── Row-Level Security ───────────────────────────────────────
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices_org_members_all"
  ON invoices
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
CREATE TRIGGER set_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();
