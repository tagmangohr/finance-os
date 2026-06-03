-- ============================================================
-- FILE: 008_views.sql
-- Analytical views — pre-baked queries for the Finance OS UI
-- ============================================================

-- ── 1. vw_revenue_by_month ───────────────────────────────────
-- Monthly P&L summary per organization.
CREATE OR REPLACE VIEW vw_revenue_by_month AS
SELECT
  org_id,
  date_trunc('month', transaction_date)::date          AS month,
  COALESCE(SUM(amount) FILTER (WHERE type = 'credit'), 0) AS total_credits,
  COALESCE(SUM(amount) FILTER (WHERE type = 'debit'),  0) AS total_debits,
  COALESCE(SUM(amount) FILTER (WHERE type = 'credit'), 0)
    - COALESCE(SUM(amount) FILTER (WHERE type = 'debit'), 0) AS net
FROM transactions
WHERE status IN ('completed', 'refunded')
GROUP BY org_id, date_trunc('month', transaction_date);

-- ── 2. vw_top_customers ──────────────────────────────────────
-- All customers ranked by total revenue within their organization.
CREATE OR REPLACE VIEW vw_top_customers AS
SELECT
  e.org_id,
  e.id                      AS entity_id,
  e.name,
  e.total_revenue,
  e.outstanding_amount,
  e.last_transaction_date,
  RANK() OVER (
    PARTITION BY e.org_id
    ORDER BY e.total_revenue DESC
  )                         AS revenue_rank
FROM entities e
WHERE e.type = 'customer';

-- ── 3. vw_overdue_invoices ───────────────────────────────────
-- Invoices that are explicitly overdue, or sent but past their due date.
CREATE OR REPLACE VIEW vw_overdue_invoices AS
SELECT
  i.id                                        AS invoice_id,
  i.org_id,
  i.entity_id,
  ent.name                                    AS entity_name,
  ent.email                                   AS entity_email,
  i.invoice_number,
  i.amount,
  i.currency,
  i.status,
  i.due_date,
  (CURRENT_DATE - i.due_date)::integer        AS days_overdue,
  i.connector_id,
  i.created_at
FROM invoices i
JOIN entities ent ON ent.id = i.entity_id
WHERE
  i.status = 'overdue'
  OR (i.status = 'sent' AND i.due_date < CURRENT_DATE);

-- ── 4. vw_category_breakdown ─────────────────────────────────
-- Expense (debit) breakdown by category per organization.
-- Percentages are within the org's total debit spend.
CREATE OR REPLACE VIEW vw_category_breakdown AS
WITH org_totals AS (
  SELECT
    org_id,
    SUM(amount) AS grand_total
  FROM transactions
  WHERE
    type = 'debit'
    AND status IN ('completed', 'refunded')
  GROUP BY org_id
)
SELECT
  t.org_id,
  COALESCE(t.category, 'Uncategorized')   AS category,
  SUM(t.amount)                           AS total_amount,
  COUNT(*)                                AS transaction_count,
  ROUND(
    SUM(t.amount) / NULLIF(ot.grand_total, 0) * 100,
    2
  )                                       AS pct_of_total
FROM transactions t
JOIN org_totals ot ON ot.org_id = t.org_id
WHERE
  t.type = 'debit'
  AND t.status IN ('completed', 'refunded')
GROUP BY t.org_id, COALESCE(t.category, 'Uncategorized'), ot.grand_total
ORDER BY t.org_id, total_amount DESC;
