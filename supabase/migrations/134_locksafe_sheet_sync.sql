-- 134_locksafe_sheet_sync.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- FIX: Google Sheet sync fails every run at the "rebuild" phase with
--   "canceling statement due to lock timeout".
--
-- Root cause (measured in prod): the sheet sync suppressed the per-row rollup
-- triggers during delete+apply (app.skip_rollup='on') and then, in a final phase,
-- called rebuild_org_rollups(org) — a DELETE+INSERT across SEVEN rollup tables over
-- ALL of the org's ~550k rows. On a high-write org, live payment ingestion is
-- continuously upserting those exact rollup rows, so the full-org rewrite can never
-- acquire its lock → lock_timeout → the job fails, the connector never flips to
-- synced, and synced_through stays frozen. (For a bank-only sheet of ~850 rows this
-- is a wildly disproportionate whole-org rewrite that fights unrelated live traffic.)
--
-- Fix: STOP suppressing the triggers during the sheet's delete+apply. The triggers
-- then maintain the rollups INCREMENTALLY — the same short, lock-safe upserts live
-- payment ingestion already does — touching only the (org, day) partitions the sheet
-- actually changed, never a whole-org rewrite. The separate full-org rebuild phase
-- is then unnecessary and is removed in the worker (lib/connectors/jobs.ts).
--
-- Correctness: the sheet stays a FULL MIRROR. A changed cell re-hashes the row's
-- external_id, so an edit = delete-old (−OLD delta) in sheet_delete_absent + insert-
-- new (+NEW delta) in apply_sheet_chunk; an unchanged row hits ON CONFLICT with no
-- field diff → no UPDATE → no trigger. So every change (old rows included) is
-- reflected exactly once, with no double-count. Bodies below are VERBATIM copies of
-- migrations 132 (apply) and 092 (delete), with only the two set_config(app.skip_
-- rollup,...) guards removed.
--
-- APPLY ORDER: apply this migration BEFORE deploying the worker change. While the
-- old worker still runs, apply now maintains rollups incrementally AND the obsolete
-- rebuild phase still runs (and still lock-fails as today) — so data becomes correct
-- immediately and nothing regresses; the worker deploy then drops the dead phase.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Apply staged rows (132 body, triggers NO LONGER suppressed) ─────────────
create or replace function apply_sheet_chunk(p_job uuid, p_offset int, p_limit int)
returns int language plpgsql security definer as $$
declare n int;
begin
  set local statement_timeout = 0;
  with slice as (
    select * from sheet_sync_rows where job_id = p_job order by row_index offset p_offset limit p_limit
  ), ins as (
    insert into transactions (
      org_id, connector_id, external_id, type, amount, currency, amount_base, base_currency,
      fx_rate, category, counterparty_name, description, source, status, ledger, account_type,
      transaction_date, transaction_at, metadata
    )
    select
      org_id, connector_id, external_id,
      (payload->>'type')::transaction_type,
      (payload->>'amount')::numeric,
      payload->>'currency',
      nullif(payload->>'amount_base','')::numeric,
      nullif(payload->>'base_currency',''),
      nullif(payload->>'fx_rate','')::numeric,
      nullif(payload->>'category',''),
      nullif(payload->>'counterparty_name',''),
      nullif(payload->>'description',''),
      payload->>'source',
      (payload->>'status')::transaction_status,
      coalesce(nullif(payload->>'ledger',''), 'bank'),
      nullif(payload->>'account_type',''),
      (payload->>'transaction_date')::date,
      nullif(payload->>'transaction_at','')::timestamptz,
      coalesce(payload->'metadata', '{}'::jsonb)
    from slice
    on conflict (org_id, connector_id, external_id) where external_id is not null
    do update set
      type              = case when coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ? 'type'              then transactions.type              else excluded.type end,
      amount            = case when coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ? 'amount'            then transactions.amount            else excluded.amount end,
      currency          = case when coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ? 'currency'          then transactions.currency          else excluded.currency end,
      counterparty_name = case when coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ? 'counterparty_name' then transactions.counterparty_name else excluded.counterparty_name end,
      description       = case when coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ? 'description'       then transactions.description       else excluded.description end,
      transaction_date  = case when coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ? 'transaction_date'  then transactions.transaction_date  else excluded.transaction_date end,
      ledger            = case when coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ? 'ledger'            then transactions.ledger            else excluded.ledger end,
      account_type      = case when coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ? 'account_type'      then transactions.account_type      else excluded.account_type end,
      amount_base       = case when coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ?| array['amount','amount_base']   then transactions.amount_base   else excluded.amount_base end,
      base_currency     = case when coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ?| array['amount','base_currency'] then transactions.base_currency else excluded.base_currency end,
      fx_rate           = case when coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ?| array['amount','fx_rate']       then transactions.fx_rate       else excluded.fx_rate end,
      metadata          = case
                            when coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ? 'metadata' then transactions.metadata
                            when coalesce(transactions.metadata->'manual_fields','[]'::jsonb) <> '[]'::jsonb
                              then excluded.metadata || jsonb_build_object('manual_fields', transactions.metadata->'manual_fields')
                            else excluded.metadata
                          end
      -- category, pnl_treatment, status, transaction_at, source, raw are intentionally
      -- NOT updated (user-owned / immutable) — parity with the direct merge refresh loop.
    where (
      (not coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ? 'type'              and transactions.type              is distinct from excluded.type) or
      (not coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ? 'amount'            and transactions.amount            is distinct from excluded.amount) or
      (not coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ? 'currency'          and transactions.currency          is distinct from excluded.currency) or
      (not coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ? 'counterparty_name' and transactions.counterparty_name is distinct from excluded.counterparty_name) or
      (not coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ? 'description'       and transactions.description       is distinct from excluded.description) or
      (not coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ? 'transaction_date'  and transactions.transaction_date  is distinct from excluded.transaction_date) or
      (not coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ? 'ledger'            and transactions.ledger            is distinct from excluded.ledger) or
      (not coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ? 'account_type'      and transactions.account_type      is distinct from excluded.account_type) or
      (not coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ?| array['amount','amount_base']   and transactions.amount_base   is distinct from excluded.amount_base) or
      (not coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ?| array['amount','fx_rate']       and transactions.fx_rate       is distinct from excluded.fx_rate) or
      (not coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ?| array['amount','base_currency'] and transactions.base_currency is distinct from excluded.base_currency) or
      (not coalesce(transactions.metadata->'manual_fields','[]'::jsonb) ? 'metadata'          and transactions.metadata          is distinct from (
          case when coalesce(transactions.metadata->'manual_fields','[]'::jsonb) <> '[]'::jsonb
               then excluded.metadata || jsonb_build_object('manual_fields', transactions.metadata->'manual_fields')
               else excluded.metadata end))
    )
    returning 1
  )
  select count(*) into n from ins;
  return coalesce(n, 0);
end $$;

grant execute on function apply_sheet_chunk(uuid, int, int) to service_role;
alter function apply_sheet_chunk(uuid, int, int) set statement_timeout = '600s';

-- ── Delete rows absent from the current parse (092 body, triggers NOT suppressed) ──
create or replace function sheet_delete_absent(p_job uuid, p_org uuid, p_conn uuid)
returns void language plpgsql security definer as $$
begin
  set local statement_timeout = 0;
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
end $$;

grant execute on function sheet_delete_absent(uuid, uuid, uuid) to service_role;
alter function sheet_delete_absent(uuid, uuid, uuid) set statement_timeout = '600s';
