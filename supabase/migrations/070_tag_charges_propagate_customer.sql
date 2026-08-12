-- ============================================================
-- FILE: 070_tag_charges_propagate_customer.sql
-- Extend the invoice→charge reconcile so it ALSO propagates customer identity
-- (name/email/phone) from gateway_invoices onto the charge — not just subscription_id.
--
-- Why: Stripe invoice-driven charges (subscription renewals/retries) come back with
-- billing_details.* = null and no receipt_email, so the charge row has no searchable
-- customer. But the linked invoice DOES carry customer_email/name (data.customer is
-- resolved when we sync invoices). This makes every invoice-linked charge searchable
-- by customer going forward, in the same fast set-based statement (idx on
-- gateway_invoices.charge_external_id), run nightly + after invoice sync.
--
-- Fill-only for every field (coalesce keeps whatever the charge already has; email/phone
-- only added when absent), so it never overwrites a real value and stays idempotent.
-- email/phone use the `email`/`phone` metadata keys the Payments UI + CSV read.
-- App call is unchanged (rpc: tag_subscription_charges); only the body grows.
-- ============================================================

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
     set subscription_id = coalesce(t.subscription_id, gi.subscription_id),
         counterparty_name = coalesce(
           t.counterparty_name,
           nullif(btrim(gi.customer_name), ''),
           nullif(btrim(gi.customer_email), '')
         ),
         metadata =
           coalesce(t.metadata, '{}'::jsonb)
           || case when (t.metadata->>'email') is null and nullif(btrim(gi.customer_email),'') is not null
                   then jsonb_build_object('email', gi.customer_email) else '{}'::jsonb end
           || case when (t.metadata->>'phone') is null and nullif(btrim(gi.customer_phone),'') is not null
                   then jsonb_build_object('phone', gi.customer_phone) else '{}'::jsonb end
    from gateway_invoices gi
   where t.external_id = gi.charge_external_id
     and t.org_id      = gi.org_id
     and gi.charge_external_id is not null
     and (
       -- something to fill on at least one dimension (keeps the update set minimal + idempotent)
       (gi.subscription_id is not null and t.subscription_id is null)
       or (t.counterparty_name is null
           and coalesce(nullif(btrim(gi.customer_name),''), nullif(btrim(gi.customer_email),'')) is not null)
       or ((t.metadata->>'email') is null and nullif(btrim(gi.customer_email),'') is not null)
       or ((t.metadata->>'phone') is null and nullif(btrim(gi.customer_phone),'') is not null)
     );
  get diagnostics n = row_count;
  return n;
end
$$;

comment on function public.tag_subscription_charges() is
  'Reconciles charges from gateway_invoices: fills transactions.subscription_id AND customer identity (counterparty_name + metadata.email/phone) from the linked invoice. Fill-only + idempotent, one indexed set-based statement (idx_gwinvoices_charge). Run after invoice sync (backfill + nightly).';
