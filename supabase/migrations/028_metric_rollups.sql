-- ============================================================
-- FILE: 028_metric_rollups.sql
-- Metric rollup views — server-side aggregation for the dashboard.
--
-- WHY: the dashboard used to fetch raw transaction rows into the Node layer and
-- aggregate in JS. Supabase caps a plain .select() at 1000 rows, so for a large
-- org (100k+ rows) it only ever saw the OLDEST 1000 and every recent-month metric
-- (MRR, revenue trend, success rate, …) computed to ~0. These views push the
-- aggregation into Postgres: one small pre-summed row set per org, no cap, and it
-- scales as transaction volume grows.
--
-- Conventions (match lib/data.ts / lib/intelligence):
--   • Amounts in base currency (INR): COALESCE(amount_base, amount) — same as baseAmt().
--   • Exclude gateway transfers (settlement/payout) and the 'settlement' category so
--     moving already-counted money to the bank never double-counts as revenue/expense.
--   • Guard transaction_date <= current_date so corrupt/sentinel future dates
--     (e.g. a dispute backfilled with 9999-09-08) can never leak into a metric.
--   • Net revenue is refund-consistent across gateways: some refunds are a separate
--     debit row (Cashfree), others collapse onto the sale as status='refunded'
--     (Stripe/App Store). Counting refunded-status credits AND refund debits as
--     "refunds" makes net = gross − refunds correct for both.
--
-- Views are the same style as 008_views.sql (definer view; the app always filters
-- by org_id, and org_id is only known for the caller's own org).
-- ============================================================

-- Base amount in INR.
--   COALESCE(amount_base, amount)
-- A transfer (settlement/payout) is any source matching settlement|payout.

-- ── 1. Monthly revenue rollup (last 13 months, for trend + run-rate MRR) ──
CREATE OR REPLACE VIEW vw_metrics_monthly AS
SELECT
  t.org_id,
  date_trunc('month', t.transaction_date)::date AS month,
  COALESCE(SUM(COALESCE(t.amount_base, t.amount))
    FILTER (WHERE t.type = 'credit' AND t.status IN ('completed', 'refunded')), 0) AS gross_revenue,
  COALESCE(SUM(COALESCE(t.amount_base, t.amount))
    FILTER (WHERE t.type = 'debit' AND t.category = 'refund'), 0)
  + COALESCE(SUM(COALESCE(t.amount_base, t.amount))
    FILTER (WHERE t.type = 'credit' AND t.status = 'refunded'), 0) AS refunds,
  COALESCE(SUM(COALESCE(t.amount_base, t.amount))
    FILTER (WHERE t.type = 'debit'
      AND COALESCE(t.category, '') NOT IN ('refund', 'dispute', 'settlement')), 0) AS expense_total,
  COUNT(*) FILTER (WHERE t.type = 'credit' AND t.status = 'completed') AS txn_count,
  COUNT(DISTINCT lower(t.counterparty_name))
    FILTER (WHERE t.type = 'credit' AND t.status = 'completed'
      AND COALESCE(t.counterparty_name, '') <> '') AS paying_customers
FROM transactions t
WHERE t.transaction_date <= current_date
  AND t.transaction_date >= (date_trunc('month', current_date) - interval '13 months')::date
  AND COALESCE(t.category, '') <> 'settlement'
  AND COALESCE(t.source, '') !~* '(settlement|payout)'
GROUP BY t.org_id, date_trunc('month', t.transaction_date);

-- ── 2. Payment health (rolling 90-day window, one row per org) ──
CREATE OR REPLACE VIEW vw_metrics_payment_health AS
SELECT
  t.org_id,
  COUNT(*) FILTER (WHERE t.type = 'credit' AND t.status = 'completed') AS completed_count,
  COUNT(*) FILTER (WHERE t.type = 'credit' AND t.status = 'failed')    AS failed_count,
  COUNT(*) FILTER (WHERE t.type = 'credit' AND t.status = 'pending')   AS pending_count,
  COUNT(*) FILTER (WHERE t.type = 'credit' AND t.status = 'refunded')  AS refunded_count,
  COALESCE(SUM(COALESCE(t.amount_base, t.amount))
    FILTER (WHERE t.type = 'credit' AND t.status = 'completed'), 0) AS net_completed_volume,
  COALESCE(SUM(COALESCE(t.amount_base, t.amount))
    FILTER (WHERE t.type = 'credit' AND t.status IN ('completed', 'refunded')), 0) AS gross_volume,
  COALESCE(SUM(COALESCE(t.amount_base, t.amount))
    FILTER (WHERE t.type = 'debit' AND t.category = 'refund'), 0)
  + COALESCE(SUM(COALESCE(t.amount_base, t.amount))
    FILTER (WHERE t.type = 'credit' AND t.status = 'refunded'), 0) AS refund_amount,
  COUNT(*) FILTER (WHERE t.category = 'dispute')                       AS dispute_count,
  COALESCE(SUM(COALESCE(t.amount_base, t.amount))
    FILTER (WHERE t.category = 'dispute'), 0)                          AS dispute_amount
FROM transactions t
WHERE t.transaction_date <= current_date
  AND t.transaction_date >= current_date - interval '90 days'
  AND COALESCE(t.category, '') <> 'settlement'
  AND COALESCE(t.source, '') !~* '(settlement|payout)'
GROUP BY t.org_id;

-- ── 3. Customer snapshot (rolling 90-day window, one row per org) ──
-- Identity is the counterparty label (email/phone/name) — weak but the best we
-- have until subscription modeling (Phase 2 adds churn / NRR / LTV).
CREATE OR REPLACE VIEW vw_metrics_customers AS
SELECT
  t.org_id,
  COUNT(DISTINCT lower(t.counterparty_name))
    FILTER (WHERE COALESCE(t.counterparty_name, '') <> '') AS paying_customers,
  COALESCE(SUM(COALESCE(t.amount_base, t.amount)), 0)      AS net_revenue,
  COUNT(*)                                                 AS txn_count
FROM transactions t
WHERE t.transaction_date <= current_date
  AND t.transaction_date >= current_date - interval '90 days'
  AND t.type = 'credit' AND t.status = 'completed'
  AND COALESCE(t.category, '') <> 'settlement'
  AND COALESCE(t.source, '') !~* '(settlement|payout)'
GROUP BY t.org_id;

-- ── 4. Lifetime totals (one row per org) — cash-position proxy until expenses land ──
CREATE OR REPLACE VIEW vw_metrics_totals AS
SELECT
  t.org_id,
  COALESCE(SUM(COALESCE(t.amount_base, t.amount))
    FILTER (WHERE t.type = 'credit' AND t.status = 'completed'), 0) AS lifetime_inflow,
  COALESCE(SUM(COALESCE(t.amount_base, t.amount))
    FILTER (WHERE t.type = 'debit'
      AND COALESCE(t.category, '') NOT IN ('dispute', 'settlement')), 0) AS lifetime_outflow
FROM transactions t
WHERE t.transaction_date <= current_date
  AND COALESCE(t.category, '') <> 'settlement'
  AND COALESCE(t.source, '') !~* '(settlement|payout)'
GROUP BY t.org_id;

GRANT SELECT ON vw_metrics_monthly, vw_metrics_payment_health, vw_metrics_customers, vw_metrics_totals TO authenticated, anon, service_role;
