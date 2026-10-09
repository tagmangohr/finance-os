-- 132_apply_sheet_chunk_refresh.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- BUG: edited sheet values on STABLE-KEY (matrix / payroll-grid) rows never update.
--
-- apply_sheet_chunk (the scalable staging-apply path, 088) upserts with
-- `ON CONFLICT DO NOTHING`. That was correct under 088's original assumption: the
-- sheet external_id is a hash of the WHOLE row, so a changed value re-keys → the old
-- row is removed by sheet_delete_absent and the new value re-inserted. BUT matrix
-- (payroll) tabs were later keyed by (employee label, month column) ONLY, NOT the
-- value (links.ts, so filling other months doesn't re-key a person's existing cells).
-- For those rows a changed number keeps the SAME id → not absent → DO NOTHING → the
-- new value is silently dropped and the stale number persists.
--
-- The DIRECT merge path (mergeConnectorTransactions, sync.ts) was already upgraded to
-- a refresh loop that handles this; the staging path was never brought to parity, so
-- whether an edit lands depended on which path synced. This aligns the two.
--
-- FIX: ON CONFLICT DO UPDATE the SOURCE fields from the fresh sheet row, mirroring the
-- direct path's refresh set EXACTLY:
--   • refreshes: type, amount, currency, counterparty_name, description,
--     transaction_date, ledger, account_type, amount_base, base_currency, fx_rate, metadata
--   • PRESERVES user-owned fields — never touches category / pnl_treatment (so manual
--     categorization survives re-syncs), and never status / transaction_at / source / raw
--     (same columns the direct path leaves alone).
--   • honours metadata.manual_fields: any field the user edited in-app is kept (not
--     overwritten by the sheet); if 'amount' is manual, its derived amount_base/
--     base_currency/fx_rate are kept too; the manual_fields marker is preserved.
--   • only writes when a non-manual source field actually DIFFERS — a steady-state
--     re-sync (sheet unchanged) writes nothing, so no table bloat / dead tuples.
--
-- NOTE: `metadata->'manual_fields'` is coalesced to '[]' before every `?` test — a
-- missing key yields jsonb NULL, and `NULL ? 'x'` is NULL, which would poison the
-- WHERE (NULL→skip) and wrongly drop legitimately-changed rows that have no manual
-- edits (the common case). Coalescing makes `?` return a proper boolean.
--
-- Pure function redefinition (no data change). Already-stale matrix values correct
-- themselves on the NEXT sheet sync; no rebuild needed as part of this migration.
-- SAFE to run as a normal migration.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function apply_sheet_chunk(p_job uuid, p_offset int, p_limit int)
returns int language plpgsql security definer as $$
declare n int;
begin
  set local statement_timeout = 0;
  perform set_config('app.skip_rollup', 'on', true);
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
  perform set_config('app.skip_rollup', 'off', true);
  return coalesce(n, 0);
end $$;

grant execute on function apply_sheet_chunk(uuid, int, int) to service_role;
