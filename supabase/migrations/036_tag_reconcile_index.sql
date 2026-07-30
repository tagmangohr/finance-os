-- ============================================================
-- FILE: 036_tag_reconcile_index.sql
-- Make the subscription-tag reconcile fast (it was timing out at 8s).
--
-- Root cause: the only index covering external_id is the UNIQUE
-- (org_id, connector_id, external_id) — with connector_id in the middle, a join on
-- (org_id, external_id) can't use it and falls back to a scan of the org's rows.
-- This adds a proper (org_id, external_id) index (also speeds up the dedup hot path
-- getExistingTransactionsByExternalId), and gives the reconcile function headroom.
-- ============================================================

-- Fast lookups/joins by external_id (subscription tagging + dedup).
create index if not exists idx_transactions_org_external
  on public.transactions (org_id, external_id)
  where external_id is not null;

-- Recreate the reconcile with a generous statement_timeout so a one-off/backfill run
-- can complete even on a cold plan. Same fill-only, idempotent body as migration 034.
create or replace function public.tag_subscription_charges()
returns integer
language plpgsql
security definer
set search_path = public
set statement_timeout = '300s'
as $$
declare n integer;
begin
  update transactions t
     set subscription_id = gi.subscription_id
    from gateway_invoices gi
   where t.external_id = gi.charge_external_id
     and t.org_id      = gi.org_id
     and gi.subscription_id  is not null
     and gi.charge_external_id is not null
     and t.subscription_id is null;
  get diagnostics n = row_count;
  return n;
end
$$;
