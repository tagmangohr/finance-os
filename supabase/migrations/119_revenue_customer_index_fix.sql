-- 119_revenue_customer_index_fix.sql
-- The covering index from 118 BACKFIRED: it pushed the planner into an index-only
-- scan that thrashes on heap visibility checks (transactions is high-churn, so its
-- visibility map is rarely all-visible) — short ranges regressed (30d: 0.45s→5.7s)
-- and 12mo still timed out.
--
-- Replace it with a LEAN PARTIAL index (no INCLUDE, no expression key, so no
-- index-only scan is possible). It just restricts the scan to the ~154k posted-
-- payment rows instead of all ~447k credit rows in the window — a plain index
-- range scan + heap read in roughly date (= heap) order. That's the actual
-- bottleneck the measurements pointed to (the scan, not jsonb parsing).

drop index if exists idx_txn_revenue_customer;

create index if not exists idx_txn_posted_payments
  on transactions (org_id, transaction_date)
  where type = 'credit'
    and ledger = 'payments'
    and status in ('completed','refunded')
    and coalesce(category, '') <> 'settlement'
    and coalesce(source, '') !~ '_(payout|settlement)$';

-- Functions are unchanged from 118 (their results are correct); only the index
-- strategy changes. Re-declared here so applying 119 alone is sufficient and the
-- bodies no longer read as if tuned for the dropped covering index.

create or replace function revenue_top_customers(p_org uuid, p_from date, p_to date, p_limit int default 5)
returns table(customer_key text, name text, revenue numeric, txns bigint)
language sql stable as $$
  select
    coalesce(email, lower(cname)) as customer_key,
    max(cname)                    as name,
    coalesce(sum(amt), 0)         as revenue,
    count(*)                      as txns
  from (
    select
      case when lower(coalesce(t.metadata->>'email','')) like '%@razorpay.com'
             or lower(coalesce(t.metadata->>'email','')) in ('','na','n/a')
           then null else lower(t.metadata->>'email') end  as email,
      case when lower(coalesce(t.counterparty_name,'')) like '%@razorpay.com'
             or btrim(coalesce(t.counterparty_name,'')) = ''
           then null else t.counterparty_name end          as cname,
      coalesce(t.amount_base, t.amount)                    as amt
    from transactions t
    where t.org_id = p_org
      and t.type = 'credit'
      and t.ledger = 'payments'
      and t.status in ('completed','refunded')
      and coalesce(t.category, '') <> 'settlement'
      and coalesce(t.source, '') !~ '_(payout|settlement)$'
      and t.transaction_date >= p_from and t.transaction_date <= p_to
  ) b
  where coalesce(email, cname) is not null
  group by 1
  having coalesce(sum(amt), 0) > 0
  order by revenue desc
  limit greatest(p_limit, 1);
$$;

create or replace function revenue_paying_customers(p_org uuid, p_from date, p_to date)
returns bigint
language sql stable as $$
  select count(distinct coalesce(email, lower(cname)))
  from (
    select
      case when lower(coalesce(t.metadata->>'email','')) like '%@razorpay.com'
             or lower(coalesce(t.metadata->>'email','')) in ('','na','n/a')
           then null else lower(t.metadata->>'email') end  as email,
      case when lower(coalesce(t.counterparty_name,'')) like '%@razorpay.com'
             or btrim(coalesce(t.counterparty_name,'')) = ''
           then null else t.counterparty_name end          as cname
    from transactions t
    where t.org_id = p_org
      and t.type = 'credit'
      and t.ledger = 'payments'
      and t.status in ('completed','refunded')
      and coalesce(t.category, '') <> 'settlement'
      and coalesce(t.source, '') !~ '_(payout|settlement)$'
      and t.transaction_date >= p_from and t.transaction_date <= p_to
  ) b
  where coalesce(email, cname) is not null;
$$;

grant execute on function revenue_top_customers(uuid, date, date, int),
                         revenue_paying_customers(uuid, date, date)
  to authenticated, anon, service_role;

-- Safety margin: these are intentionally heavy analytical scans called from a
-- CACHED server loader (not a hot path), so give them room above the role's 8s
-- default. With the partial index the real runtime is a few seconds; this just
-- prevents a borderline run from being killed. (ALTER FUNCTION ... SET keeps the
-- functions STABLE — unlike an in-body SET, which is illegal in a STABLE fn.)
alter function revenue_top_customers(uuid, date, date, int)  set statement_timeout = '20s';
alter function revenue_paying_customers(uuid, date, date)     set statement_timeout = '20s';
