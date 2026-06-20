-- Multi-currency support — store the base-currency (INR) equivalent per transaction.
--
-- Aggregations summed raw `amount` regardless of `currency`, so USD/EUR charges
-- were counted as if they were rupees. `amount_base` holds the INR equivalent
-- (for Stripe, the real settled figure from the charge's balance transaction);
-- all aggregations sum amount_base (falling back to amount for rows not yet
-- converted) so currencies are never mixed.

alter table public.transactions
  add column if not exists amount_base   numeric,
  add column if not exists base_currency text,
  add column if not exists fx_rate       numeric;

-- Rows already in the base currency are 1:1. Foreign-currency rows are left null
-- and get their INR equivalent on the next sync (Stripe balance-transaction).
update public.transactions
  set amount_base = amount, base_currency = 'INR', fx_rate = 1
  where amount_base is null and (currency = 'INR' or currency is null);

-- Category breakdown must sum the base-currency amount (fallback to amount).
CREATE OR REPLACE VIEW vw_category_breakdown AS
WITH org_totals AS (
  SELECT
    org_id,
    SUM(COALESCE(amount_base, amount)) AS grand_total
  FROM transactions
  WHERE
    type = 'debit'
    AND status IN ('completed', 'refunded')
    AND category NOT IN ('refund', 'dispute')
  GROUP BY org_id
)
SELECT
  t.org_id,
  COALESCE(t.category, 'Uncategorized')        AS category,
  SUM(COALESCE(t.amount_base, t.amount))       AS total_amount,
  COUNT(*)                                      AS transaction_count,
  ROUND(
    SUM(COALESCE(t.amount_base, t.amount)) / NULLIF(ot.grand_total, 0) * 100,
    2
  )                                            AS pct_of_total
FROM transactions t
JOIN org_totals ot ON ot.org_id = t.org_id
WHERE
  t.type = 'debit'
  AND t.status IN ('completed', 'refunded')
  AND t.category NOT IN ('refund', 'dispute')
GROUP BY t.org_id, COALESCE(t.category, 'Uncategorized'), ot.grand_total
ORDER BY t.org_id, total_amount DESC;
