-- 092_sheet_delete_absent_protect_splits.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Protect split parts from the sheet "delete-absent" mirror.
--
-- Splitting a bank/sales row (app/api/bank/split) creates child rows that carry the
-- PARENT's connector_id but a SYNTHETIC external_id (`<parent_ext>__split_N`) that
-- never appears in the source sheet. sheet_delete_absent deletes every row for the
-- connector whose external_id isn't in the freshly-staged set — so on the next sheet
-- sync it would DELETE the split children, and since the parent stays
-- is_split_parent+excluded (hidden), the whole transaction would vanish. Splitting is
-- a categorization action, so this silently undid the user's work on re-sync.
--
-- Fix: never mirror-delete split children (split_parent_id is not null). Their
-- lifecycle is owned by the split/unsplit feature. The parent removal case is still
-- handled correctly: if the parent's own sheet row disappears (or is edited → re-keyed),
-- the parent is deleted and its children cascade away via the split_parent_id FK
-- (on delete cascade), so no orphans are left behind either way.
--
-- Verbatim from 088 + the `and t.split_parent_id is null` guard on the mirror delete.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function sheet_delete_absent(p_job uuid, p_org uuid, p_conn uuid)
returns void language plpgsql security definer as $$
begin
  set local statement_timeout = 0;
  perform set_config('app.skip_rollup', 'on', true);
  -- Legacy null-external_id rows for this connector can't be mirrored → drop them
  -- (but never the app-generated split children).
  delete from transactions
   where org_id = p_org and connector_id = p_conn and external_id is null
     and split_parent_id is null;
  -- True mirror: remove rows this connector produced that the current parse no
  -- longer yields — EXCEPT split children (app-generated; not sourced from the sheet).
  delete from transactions t
   where t.org_id = p_org and t.connector_id = p_conn and t.external_id is not null
     and t.split_parent_id is null
     and not exists (select 1 from sheet_sync_rows s where s.job_id = p_job and s.external_id = t.external_id);
  perform set_config('app.skip_rollup', 'off', true);
end $$;

grant execute on function sheet_delete_absent(uuid, uuid, uuid) to service_role;
