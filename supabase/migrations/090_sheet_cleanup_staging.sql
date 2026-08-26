-- 090_sheet_cleanup_staging.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Make the sheet-sync pipeline fully timeout-free at any scale (25k / 100k+ rows).
--
-- The heavy work (apply_sheet_chunk / sheet_delete_absent / rebuild_org_rollups)
-- already runs inside functions that `set local statement_timeout = 0`. But the
-- background job (processSheetJob) still cleared the staging table with a PLAIN
-- PostgREST delete:  from("sheet_sync_rows").delete().eq("job_id", …). That single
-- statement runs under the connection's default statement_timeout, so deleting the
-- whole staged batch (18k → 100k rows) could exceed it — exactly the
-- "canceling statement due to statement timeout" seen after an 18k sheet load. The
-- data + rollups were already correct by then, so the job only self-healed on retry;
-- at 100k it would time out every pass and eventually fail the job with orphaned
-- staging rows.
--
-- Move that delete into a timeout-free function so no statement in the pipeline is
-- ever bounded by the 8s cap.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function sheet_cleanup_staging(p_job uuid)
returns void language plpgsql security definer as $$
begin
  set local statement_timeout = 0;
  delete from sheet_sync_rows where job_id = p_job;
end $$;

grant execute on function sheet_cleanup_staging(uuid) to service_role;
