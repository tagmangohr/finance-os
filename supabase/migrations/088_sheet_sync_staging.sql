-- 088_sheet_sync_staging.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Scalable link-connector (Google Sheet / Excel) sync — handles 100k+ rows.
--
-- The old path merged an ENTIRE sheet in ONE web request → statement/function
-- timeouts at scale. New model (mirrors the gateway job queue):
--   1. Parse the sheet ONCE (in a 300s route/after) → bulk-load the normalized rows
--      into a STAGING table (no triggers here → fast even for 100k).
--   2. A background job drains three phases across cron passes:
--        delete  → sheet_delete_absent()  (true-mirror removal, one set-based step)
--        apply   → apply_sheet_chunk()     (server-side INSERT…SELECT from staging,
--                                           row-cursor chunks, ON CONFLICT DO NOTHING)
--        rebuild → rebuild_org_rollups()   (recompute THIS org's rollups once)
--   3. During delete+apply the rollup triggers are SUPPRESSED (app.skip_rollup, the
--      guard added in 085) so 100k rows don't fire 500k trigger executions; the
--      per-org rebuild recomputes the affected rollups in one shot at the end.
--
-- Correctness: the sheet external_id is a content hash, so an unchanged row keeps
-- its id (ON CONFLICT DO NOTHING → categorization preserved), a changed row re-keys
-- (old removed by delete-absent, new inserted), and the unique index guarantees no
-- duplicates. The per-org rebuild reuses the SAME helper functions as the global
-- rebuilds, so numbers can't drift.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Staging table (one batch per sync job) ──────────────────────────────────
create table if not exists sheet_sync_rows (
  id           bigint generated always as identity primary key,
  job_id       uuid    not null,
  org_id       uuid    not null,
  connector_id uuid    not null,
  row_index    int     not null,
  external_id  text    not null,
  payload      jsonb   not null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_sheet_sync_rows_job on sheet_sync_rows (job_id, row_index);
create index if not exists idx_sheet_sync_rows_job_ext on sheet_sync_rows (job_id, external_id);
alter table sheet_sync_rows enable row level security; -- service-role only (no policies)
grant select, insert, update, delete on sheet_sync_rows to service_role;

-- ── Apply one chunk: staged rows → transactions (server-side, rollups suppressed) ──
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
    on conflict (org_id, connector_id, external_id) where external_id is not null do nothing
    returning 1
  )
  select count(*) into n from ins;
  perform set_config('app.skip_rollup', 'off', true);
  return coalesce(n, 0);
end $$;

-- ── Delete-absent (true mirror) + legacy null cleanup, rollups suppressed ────
create or replace function sheet_delete_absent(p_job uuid, p_org uuid, p_conn uuid)
returns void language plpgsql security definer as $$
begin
  set local statement_timeout = 0;
  perform set_config('app.skip_rollup', 'on', true);
  delete from transactions
   where org_id = p_org and connector_id = p_conn and external_id is null;
  delete from transactions t
   where t.org_id = p_org and t.connector_id = p_conn and t.external_id is not null
     and not exists (select 1 from sheet_sync_rows s where s.job_id = p_job and s.external_id = t.external_id);
  perform set_config('app.skip_rollup', 'off', true);
end $$;

-- ── Per-org rollup rebuild (same helpers as the global rebuilds, org-scoped) ──
-- Recomputes every metric rollup for ONE org: delete the org's rows, re-insert its
-- aggregates. Used after a bulk sheet load (triggers were suppressed) so the org's
-- P&L / dashboard / cashflow / gateway numbers are exact, without truncating other
-- orgs' rollups.
create or replace function rebuild_org_rollups(p_org uuid)
returns void language plpgsql security definer as $$
begin
  set local statement_timeout = 0;

  -- 059: revenue monthly + currency monthly + cashflow daily
  delete from rollup_revenue_monthly where org_id = p_org;
  insert into rollup_revenue_monthly (org_id, month, gross_revenue, txn_count)
    select t.org_id, date_trunc('month', t.transaction_date)::date, sum(_rev_contrib(t)), sum(_rev_qual(t))
    from transactions t where t.org_id = p_org and t.transaction_date is not null
    group by 1, 2 having sum(_rev_contrib(t)) <> 0 or sum(_rev_qual(t)) <> 0;

  delete from rollup_revenue_currency_monthly where org_id = p_org;
  insert into rollup_revenue_currency_monthly (org_id, currency, month, original, inr)
    select t.org_id, coalesce(t.currency,''), date_trunc('month', t.transaction_date)::date, sum(_rev_orig(t)), sum(_rev_contrib(t))
    from transactions t where t.org_id = p_org and t.transaction_date is not null
    group by 1, 2, 3 having sum(_rev_orig(t)) <> 0 or sum(_rev_contrib(t)) <> 0;

  delete from rollup_cashflow_daily where org_id = p_org;
  insert into rollup_cashflow_daily (org_id, day, inflow, outflow)
    select t.org_id, t.transaction_date, sum(_cf_in(t)), sum(_cf_out(t))
    from transactions t where t.org_id = p_org and t.transaction_date is not null
    group by 1, 2 having sum(_cf_in(t)) <> 0 or sum(_cf_out(t)) <> 0;

  -- 068: dashboard metrics daily + customer day
  delete from rollup_metrics_daily where org_id = p_org;
  insert into rollup_metrics_daily (org_id, day, gross, completed_amt, refunds, expense_m, outflow_l, completed_cnt, failed_cnt, pending_cnt, refunded_cnt, dispute_cnt, dispute_amt)
    select t.org_id, t.transaction_date,
      sum(_dm_gross(t)), sum(_dm_completed_amt(t)), sum(_dm_refunds(t)), sum(_dm_expense_m(t)), sum(_dm_outflow_l(t)),
      sum(_dm_completed_cnt(t)), sum(_dm_failed_cnt(t)), sum(_dm_pending_cnt(t)), sum(_dm_refunded_cnt(t)), sum(_dm_dispute_cnt(t)), sum(_dm_dispute_amt(t))
    from transactions t where t.org_id = p_org and t.transaction_date is not null
    group by t.org_id, t.transaction_date;

  delete from rollup_customer_day where org_id = p_org;
  insert into rollup_customer_day (org_id, day, cust_key, cnt)
    select t.org_id, t.transaction_date, _dm_cust_key(t), count(*)
    from transactions t where t.org_id = p_org and t.transaction_date is not null and _dm_cust_key(t) is not null
    group by t.org_id, t.transaction_date, _dm_cust_key(t);

  -- 073: P&L category day (expense per category + fees)
  delete from rollup_pnl_cat_day where org_id = p_org;
  insert into rollup_pnl_cat_day (org_id, day, category, amount)
    select t.org_id, t.transaction_date, _pnl_expense_cat(t), sum(_dm_expense_m(t))
    from transactions t where t.org_id = p_org and t.transaction_date is not null
    group by t.org_id, t.transaction_date, _pnl_expense_cat(t) having sum(_dm_expense_m(t)) <> 0;
  insert into rollup_pnl_cat_day (org_id, day, category, amount)
    select t.org_id, t.transaction_date, '__pg_fees__', sum(_pnl_fee(t))
    from transactions t where t.org_id = p_org and t.transaction_date is not null
    group by t.org_id, t.transaction_date having sum(_pnl_fee(t)) <> 0
  on conflict (org_id, day, category) do update set amount = rollup_pnl_cat_day.amount + excluded.amount;

  -- 080: revenue by gateway day
  delete from rollup_revenue_gateway_day where org_id = p_org;
  insert into rollup_revenue_gateway_day (org_id, day, gateway, amount)
    select t.org_id, t.transaction_date, _rev_gateway(t), sum(_dm_gross(t))
    from transactions t where t.org_id = p_org and t.transaction_date is not null
    group by t.org_id, t.transaction_date, _rev_gateway(t) having sum(_dm_gross(t)) <> 0;
end $$;

grant execute on function apply_sheet_chunk(uuid, int, int),
                         sheet_delete_absent(uuid, uuid, uuid),
                         rebuild_org_rollups(uuid)
  to service_role;
