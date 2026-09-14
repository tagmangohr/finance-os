-- ─────────────────────────────────────────────────────────────────────────────
-- 109 · Covering index on rollup_customer_day → fast paying-customers distinct count
-- ─────────────────────────────────────────────────────────────────────────────
-- The Analytics page's dash_metrics_monthly RPC (068) measured ~2.7s, essentially all
-- of it in its second CTE:
--     count(distinct cust_key) from rollup_customer_day
--       where org_id=? and day between ? and ? and cnt>0 group by month
-- rollup_customer_day carries ~171k rows for the org (~49k in a 6-month window). The
-- existing index idx_rollup_cust_day (org_id, day) WHERE cnt>0 finds the day range, but
-- `cust_key` is NOT in it — so Postgres heap-fetches cust_key for every matching row (on
-- a bloat-prone rollup heap) before it can dedupe. That heap trip is the 2.7s.
--
-- Adding cust_key to the index makes the whole count(distinct) an INDEX-ONLY scan (all
-- three columns present; cnt>0 is the partial predicate) — no heap visits. Same win for
-- dash_metrics_customers (068), which runs the identical count(distinct cust_key) shape.
--
-- The old (org_id, day) partial index is a strict prefix of this one, so it's now
-- redundant; kept for safety (rollup_customer_day is only written by the nightly rebuild
-- + trigger, so the extra index-maintenance cost is negligible) and can be dropped later.
--
-- ── HOW TO APPLY — run in the Supabase SQL editor. CREATE INDEX CONCURRENTLY cannot run
--    inside a transaction block, so run this statement on its own. ────────────────────

create index concurrently if not exists idx_rollup_cust_day_cover
  on rollup_customer_day (org_id, day, cust_key)
  where cnt > 0;
