-- ─────────────────────────────────────────────────────────────────────────────
-- 107 · Align the revenue-contribution helpers to the canonical _dm_excluded rule
-- ─────────────────────────────────────────────────────────────────────────────
-- The dashboard/P&L revenue metric (_dm_gross) decides "is this a countable revenue
-- row?" via _dm_excluded(r):
--     coalesce(category,'') = 'settlement' OR coalesce(source,'') ~* '(settlement|payout)'
-- i.e. drop settlement/payout transfers (case-INSENSITIVE, matched anywhere in source).
--
-- The revenue-BREAKDOWN helpers (_rev_contrib / _rev_qual / _rev_orig — they feed
-- rollup_revenue_monthly and rollup_revenue_currency_monthly, i.e. the Revenue page and
-- revenue-by-currency) instead carried their OWN inline exclusion:
--     coalesce(category,'') <> 'settlement' AND coalesce(source,'') !~ '_(payout|settlement)$'
-- which is case-SENSITIVE and only anchors to sources ENDING in _payout/_settlement.
--
-- These two rules are a strict superset relationship (anything ending in _payout also
-- CONTAINS "payout"), so the breakdown could KEEP a settlement/payout row the headline
-- DROPS — e.g. a future source named "payout_bank", "settlement_x", or upper-case
-- "SETTLEMENT" — silently making the breakdown overcount vs the headline.
--
-- Current data has ZERO divergent rows (the only such sources are cashfree_settlement,
-- razorpay_settlement, stripe_payout — all excluded by BOTH rules), so this changes no
-- number today. It removes the drift risk and gives the breakdown a single source of
-- truth identical to the headline. Only the exclusion clause changes; every other
-- condition (conn_include_income, credit, ledger in payments/sales, completed/refunded)
-- is preserved exactly. _cf_in (cashflow) keeps its own rule and is handled separately.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function _rev_contrib(r transactions) returns numeric language sql immutable as $$
  select case
    when not _dm_excluded(r)
     and r.conn_include_income and r.type = 'credit' and r.ledger in ('payments','sales')
     and r.status in ('completed','refunded')
    then coalesce(r.amount_base, r.amount) else 0 end;
$$;

create or replace function _rev_qual(r transactions) returns bigint language sql immutable as $$
  select case
    when not _dm_excluded(r)
     and r.conn_include_income and r.type = 'credit' and r.ledger in ('payments','sales')
     and r.status in ('completed','refunded')
    then 1 else 0 end;
$$;

create or replace function _rev_orig(r transactions) returns numeric language sql immutable as $$
  select case
    when not _dm_excluded(r)
     and r.conn_include_income and r.type = 'credit' and r.ledger in ('payments','sales')
     and r.status in ('completed','refunded')
    then r.amount else 0 end;
$$;

-- Helper bodies changed → the revenue rollups they maintain must be recomputed so the
-- cache matches the raw ledger (numbers are unchanged today, but the rebuild is the
-- contract for any helper change).
select rebuild_all_rollups();
