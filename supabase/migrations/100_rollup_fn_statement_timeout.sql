-- 100_rollup_fn_statement_timeout.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- BUG: the heavy rollup/sheet functions time out at the 8s PostgREST limit when
-- called via RPC (crons, sheet-sync worker), even though each sets
-- `set local statement_timeout = 0` in its body. That in-body SET does NOT extend
-- the deadline of the outer `SELECT fn(...)` statement PostgREST runs — the deadline
-- is fixed when that statement begins, before the function body executes. Proven:
-- rebuild_all_rollups() / rebuild_pnl_rollups() / rebuild_org_rollups() all error
-- "canceling statement due to statement timeout" at ~8s via RPC (they only ever
-- "worked" when run manually in the SQL editor, which has a long timeout).
--
-- Impact: the nightly reconciliation (snapshot cron -> rebuild_all_rollups) was
-- SILENTLY FAILING every night, and the Fiesta bank Google-Sheet sync failed on its
-- rebuild phase (checkpoint frozen since Aug 25), because rebuild_org_rollups scans
-- the org's full transactions table (>8s at 454k rows).
--
-- FIX: set the timeout as a FUNCTION attribute (ALTER FUNCTION ... SET
-- statement_timeout). Unlike an in-body `set local`, a function-scoped SET is applied
-- by the executor on function ENTRY and reschedules the statement-timeout timer, so
-- the whole RPC runs under the raised limit. Scoped to these specific server-side
-- heavy functions only — user-facing role/query timeouts (8s) are untouched, so the
-- dashboard stays protected. 600s is a generous ceiling; real runtimes are <60s and
-- the caller's Vercel maxDuration bounds wall-clock anyway. The in-body `set local`
-- lines are left in place (harmless belt-and-suspenders for SQL-editor runs).
-- ─────────────────────────────────────────────────────────────────────────────

alter function rebuild_all_rollups()                 set statement_timeout = '600s';
alter function rebuild_metric_rollups()              set statement_timeout = '600s';
alter function rebuild_dash_rollups()                set statement_timeout = '600s';
alter function rebuild_pnl_rollups()                 set statement_timeout = '600s';
alter function rebuild_revenue_gateway_rollups()     set statement_timeout = '600s';
alter function rebuild_txn_summary_rollup()          set statement_timeout = '600s';
alter function rebuild_org_rollups(uuid)             set statement_timeout = '600s';

-- Sheet-sync worker RPCs (same class — large delete/apply/cleanup over big orgs).
alter function apply_sheet_chunk(uuid, integer, integer) set statement_timeout = '600s';
alter function sheet_delete_absent(uuid, uuid, uuid)     set statement_timeout = '600s';
alter function sheet_cleanup_staging(uuid)               set statement_timeout = '600s';
