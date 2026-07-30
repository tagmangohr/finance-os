-- ============================================================
-- FILE: 034_tag_subscription_charges.sql
-- Fast, DB-side reconcile that tags subscription charges in `transactions` with their
-- subscription_id, using gateway_invoices as the bridge (Stripe/Razorpay).
--
-- Why an RPC: this is a set-based UPDATE ... FROM join over ~90k+ transactions; doing
-- it in one indexed statement (idx_gwinvoices_charge on charge_external_id) is instant
-- and correct, vs thousands of per-row round-trips from the app. Fill-only
-- (t.subscription_id IS NULL) so it never overwrites a tag and is fully idempotent —
-- safe to run nightly and repeatedly. Never touches amount/status — only the tag.
-- ============================================================

create or replace function public.tag_subscription_charges()
returns integer
language plpgsql
security definer
set search_path = public
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
     and t.subscription_id is null;      -- fill-only: never overwrite an existing tag
  get diagnostics n = row_count;
  return n;
end
$$;

comment on function public.tag_subscription_charges() is
  'Tags transactions.subscription_id from gateway_invoices (invoice.charge_external_id → transaction; invoice.subscription_id → the subscription). Fill-only + idempotent. Run after invoice sync (backfill + nightly). Returns rows tagged.';
