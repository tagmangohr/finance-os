-- 118_revenue_top_customers_perf.sql
-- PERF FIX for 117. The two revenue-customer functions timed out (>8s) over the
-- default 12-month range: there is no index on the posted-payments predicate, so
-- Postgres seq-scanned all ~447k credit rows in the window and parsed metadata
-- jsonb on every surviving row. Measured: 90d ≈ 4s, 12mo ≈ timeout.
--
-- Fix = a PARTIAL COVERING index that (a) contains ONLY the ~154k posted-payment
-- rows we actually aggregate (skips the ~65% failed/pending/settlement rows) and
-- (b) pre-computes lower(metadata->>'email') as a key column so the hot path never
-- parses jsonb at query time. counterparty_name + amounts ride along as INCLUDE
-- columns, making the scan index-only. The functions are rewritten so their
-- scanned expressions match the index exactly (a `raw` CTE that selects precisely
-- the indexed columns), which is what lets the planner pick the index-only scan.
-- Same results as 117 — only faster.

-- Partial covering index: leading org_id (equality) + transaction_date (range),
-- email pre-lowered as the third key, names/amounts as payload. Partial predicate
-- is the exact revenue basis from 057 so only posted payments are indexed.
create index if not exists idx_txn_revenue_customer
  on transactions (org_id, transaction_date, (lower(metadata->>'email')))
  include (counterparty_name, amount_base, amount)
  where type = 'credit'
    and ledger = 'payments'
    and status in ('completed','refunded')
    and coalesce(category, '') <> 'settlement'
    and coalesce(source, '') !~ '_(payout|settlement)$';

create or replace function revenue_top_customers(p_org uuid, p_from date, p_to date, p_limit int default 5)
returns table(customer_key text, name text, revenue numeric, txns bigint)
language sql stable as $$
  with raw as (
    -- SELECT list is exactly the indexed columns → index-only scan of the ~154k
    -- posted-payment rows (no heap, no jsonb parse at runtime).
    select
      lower(t.metadata->>'email')        as em,
      t.counterparty_name                as cn,
      coalesce(t.amount_base, t.amount)  as amt
    from transactions t
    where t.org_id = p_org
      and t.type = 'credit'
      and t.ledger = 'payments'
      and t.status in ('completed','refunded')
      and coalesce(t.category, '') <> 'settlement'
      and coalesce(t.source, '') !~ '_(payout|settlement)$'
      and t.transaction_date >= p_from and t.transaction_date <= p_to
  ), base as (
    select
      -- Razorpay stamps void@razorpay.com into BOTH email and name for anonymous
      -- charges; null it out (and blanks/na) so it can't become a fake customer.
      case when em is null or em in ('','na','n/a') or em ~ '@razorpay[.]com$'
           then null else em end                                   as email,
      case when cn is null or btrim(cn) = '' or lower(cn) ~ '@razorpay[.]com$'
           then null else cn end                                   as cname,
      amt
    from raw
  )
  select
    coalesce(email, lower(cname)) as customer_key,
    max(cname)                    as name,
    coalesce(sum(amt), 0)         as revenue,
    count(*)                      as txns
  from base
  where coalesce(email, cname) is not null
  group by 1
  having coalesce(sum(amt), 0) > 0
  order by revenue desc
  limit greatest(p_limit, 1);
$$;

create or replace function revenue_paying_customers(p_org uuid, p_from date, p_to date)
returns bigint
language sql stable as $$
  with raw as (
    select
      lower(t.metadata->>'email')        as em,
      t.counterparty_name                as cn
    from transactions t
    where t.org_id = p_org
      and t.type = 'credit'
      and t.ledger = 'payments'
      and t.status in ('completed','refunded')
      and coalesce(t.category, '') <> 'settlement'
      and coalesce(t.source, '') !~ '_(payout|settlement)$'
      and t.transaction_date >= p_from and t.transaction_date <= p_to
  ), base as (
    select
      case when em is null or em in ('','na','n/a') or em ~ '@razorpay[.]com$'
           then null else em end                                   as email,
      case when cn is null or btrim(cn) = '' or lower(cn) ~ '@razorpay[.]com$'
           then null else cn end                                   as cname
    from raw
  )
  select count(distinct coalesce(email, lower(cname)))
  from base
  where coalesce(email, cname) is not null;
$$;

grant execute on function revenue_top_customers(uuid, date, date, int),
                         revenue_paying_customers(uuid, date, date)
  to authenticated, anon, service_role;
