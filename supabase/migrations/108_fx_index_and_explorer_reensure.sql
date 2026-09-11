-- ─────────────────────────────────────────────────────────────────────────────
-- 108 · FX-sweep index (perf) + re-ensure the payments-explorer index (item 16/17)
-- ─────────────────────────────────────────────────────────────────────────────
-- Two things, both on the ~450k-row `transactions` table:
--
-- 1) FX SWEEP INDEX (the real win). The nightly fx-backfill cron and the full-history
--    FX pass query transactions CROSS-ORG on `currency` (no org_id predicate):
--      • reconcileFxRates            lib/fx/rates.ts  — currency<>'INR' + date range
--      • backfillMissingBaseAmounts  lib/fx/rates.ts  — amount_base IS NULL + currency<>'INR'
--      • last-known-rate fallback    lib/fx/rates.ts  — currency=X order transaction_date desc
--    EVERY existing index on transactions is org_id-leading, so none can serve a query
--    with no org_id filter → today all three do a full sequential scan of the whole
--    heap. Because base-currency INR is the overwhelming majority, a PARTIAL index over
--    just the foreign-currency rows is tiny and turns those seq scans into a small index
--    range scan.
--
-- 2) RE-ENSURE the payments-explorer index (095). A wide payments count was measured at
--    ~6.5s (right at the 8s statement timeout) — the exact symptom 095 was meant to cure.
--    Whether 095's index is missing or the planner reverted to a seq scan on stale stats,
--    `create index ... if not exists` (no-op if present) + `vacuum (analyze)` restores the
--    index-only fast path. Safe and idempotent either way.
--
-- Deliberately NOT added: (org_id, type, transaction_date) and a two-ledger revenue-drill
-- index. Their callers are on-demand/owner-only (the Intelligence dashboard was removed),
-- the per-page cashflow fallback doesn't filter by type, and transactions already carries
-- 26 indexes — more would tax the heavy sync-insert path without earning it. Revisit only
-- if those on-demand paths become hot.
--
-- ── HOW TO APPLY — run each statement ONE AT A TIME in the Supabase SQL editor.
--    CREATE INDEX CONCURRENTLY and VACUUM cannot run inside a transaction block. ───────

-- 1) FX foreign-currency sweep index (partial → tiny; serves all three fx/rates queries).
create index concurrently if not exists idx_txn_fx_foreign
  on transactions (currency, transaction_date)
  where currency is not null and currency <> 'INR';

-- 2) Re-ensure the payments-explorer covering index (095). No-op if it already exists.
create index concurrently if not exists idx_txn_payments_explorer
  on transactions (org_id, transaction_date desc, source, type, connector_id)
  where ledger = 'payments';

-- 3) Clear dead-tuple bloat + refresh planner stats so it stops choosing a seq scan.
vacuum (analyze) transactions;
