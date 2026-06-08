-- ============================================================
-- FILE: 012_fix_views.sql
-- Fix settlement double-counting and expense category noise
-- ============================================================

-- ── 1. vw_revenue_by_month ───────────────────────────────────
-- Settlement rows (category = 'settlement') are the gateway's delayed
-- bank transfer of already-collected payments — NOT new revenue.
-- Counting them in total_credits caused every payment to be counted
-- twice: once when collected, again when Razorpay settled it.
CREATE OR REPLACE VIEW vw_revenue_by_month AS
SELECT
  org_id,
  date_trunc('month', transaction_date)::date          AS month,
  COALESCE(SUM(amount) FILTER (
    WHERE type = 'credit'
    AND (category IS NULL OR category != 'settlement')
  ), 0)                                                AS total_credits,
  COALESCE(SUM(amount) FILTER (WHERE type = 'debit'),  0) AS total_debits,
  COALESCE(SUM(amount) FILTER (
    WHERE type = 'credit'
    AND (category IS NULL OR category != 'settlement')
  ), 0)
    - COALESCE(SUM(amount) FILTER (WHERE type = 'debit'), 0) AS net
FROM transactions
WHERE status IN ('completed', 'refunded')
GROUP BY org_id, date_trunc('month', transaction_date);

-- ── 2. vw_category_breakdown ─────────────────────────────────
-- Expense (debit) breakdown by category, for the "Expense Categories"
-- donut chart.  Refunds and disputes are revenue reversals / chargebacks,
-- not operational expenses — including them made the chart show
-- "100% refund" which is meaningless for expense analysis.
CREATE OR REPLACE VIEW vw_category_breakdown AS
WITH org_totals AS (
  SELECT
    org_id,
    SUM(amount) AS grand_total
  FROM transactions
  WHERE
    type = 'debit'
    AND status IN ('completed', 'refunded')
    AND category NOT IN ('refund', 'dispute')   -- exclude revenue reversals
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
  AND t.category NOT IN ('refund', 'dispute')   -- exclude revenue reversals
GROUP BY t.org_id, COALESCE(t.category, 'Uncategorized'), ot.grand_total
ORDER BY t.org_id, total_amount DESC;
