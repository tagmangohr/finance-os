-- ============================================================
-- FILE: 010_posted_transaction_statuses.sql
-- Use financially posted transaction statuses in analytical views
-- ============================================================

-- Financial calculations should include completed and refunded rows.
-- Pending and failed rows are audit records, but should not affect totals.

CREATE OR REPLACE VIEW vw_revenue_by_month AS
SELECT
  org_id,
  date_trunc('month', transaction_date)::date             AS month,
  COALESCE(SUM(amount) FILTER (WHERE type = 'credit'), 0) AS total_credits,
  COALESCE(SUM(amount) FILTER (WHERE type = 'debit'),  0) AS total_debits,
  COALESCE(SUM(amount) FILTER (WHERE type = 'credit'), 0)
    - COALESCE(SUM(amount) FILTER (WHERE type = 'debit'), 0) AS net
FROM transactions
WHERE status IN ('completed', 'refunded')
GROUP BY org_id, date_trunc('month', transaction_date);

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
