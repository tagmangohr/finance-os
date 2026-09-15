-- 117_revenue_top_customers.sql
-- Revenue tab "Top Customers" + "Paying customers" stats.
--
-- WHY: the Revenue page read customers from the `entities` table, which is EMPTY
-- for gateway-only orgs (no counterparty_id linkage is ever written), so the list
-- was always blank. Customer identity actually lives on the transaction itself —
-- metadata.email (most stable) with counterparty_name as the fallback. These two
-- functions aggregate customer revenue directly from transactions, using the SAME
-- revenue-recognition predicate as metrics_monthly_range (057) so the numbers tie
-- out to the rest of the Revenue tab: POSTED credit rows on the payments ledger,
-- excluding settlements/payouts, within the selected date range.
--
-- Placeholder trap: Razorpay stamps `void@razorpay.com` into BOTH the email and
-- the name for anonymous payments; left in, it collapses thousands of unrelated
-- charges into one bogus #1 "customer". We null out any @razorpay.com identity
-- (and blank/na) so it never appears and never distorts the distinct-customer
-- count. Verified against live data before writing.

create or replace function revenue_top_customers(p_org uuid, p_from date, p_to date, p_limit int default 5)
returns table(customer_key text, name text, revenue numeric, txns bigint)
language sql stable as $$
  with base as (
    select
      case when lower(coalesce(t.metadata->>'email','')) ~ '@razorpay[.]com$'
             or lower(coalesce(t.metadata->>'email','')) in ('','na','n/a')
           then null else lower(t.metadata->>'email') end            as email,
      case when lower(coalesce(t.counterparty_name,'')) ~ '@razorpay[.]com$'
             or coalesce(trim(t.counterparty_name),'') = ''
           then null else t.counterparty_name end                    as cname,
      coalesce(t.amount_base, t.amount)                              as amt
    from transactions t
    where t.org_id = p_org
      and t.type = 'credit' and t.ledger = 'payments'
      and t.status in ('completed','refunded')
      and t.transaction_date >= p_from and t.transaction_date <= p_to
      and coalesce(t.category,'') <> 'settlement'
      and coalesce(t.source,'') !~ '_(payout|settlement)$'
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
  with base as (
    select
      case when lower(coalesce(t.metadata->>'email','')) ~ '@razorpay[.]com$'
             or lower(coalesce(t.metadata->>'email','')) in ('','na','n/a')
           then null else lower(t.metadata->>'email') end            as email,
      case when lower(coalesce(t.counterparty_name,'')) ~ '@razorpay[.]com$'
             or coalesce(trim(t.counterparty_name),'') = ''
           then null else t.counterparty_name end                    as cname
    from transactions t
    where t.org_id = p_org
      and t.type = 'credit' and t.ledger = 'payments'
      and t.status in ('completed','refunded')
      and t.transaction_date >= p_from and t.transaction_date <= p_to
      and coalesce(t.category,'') <> 'settlement'
      and coalesce(t.source,'') !~ '_(payout|settlement)$'
  )
  select count(distinct coalesce(email, lower(cname)))
  from base
  where coalesce(email, cname) is not null;
$$;

grant execute on function revenue_top_customers(uuid, date, date, int),
                         revenue_paying_customers(uuid, date, date)
  to authenticated, anon, service_role;
