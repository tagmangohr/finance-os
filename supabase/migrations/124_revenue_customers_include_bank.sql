-- 124_revenue_customers_include_bank.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY: Top Customers + Paying Customers counted GATEWAY payments only
-- (revenue_top_customers / revenue_paying_customers, redeclared last in 119:
-- type='credit' AND ledger='payments'). Now that "Revenue" includes customer
-- payments collected directly into the bank (migration 123), those customers must
-- appear here too — otherwise a customer who pays by bank invoice is invisible in
-- the ranking and undercounts Paying Customers.
--
-- FIX: add a second branch for bank-collected customer invoices (ledger='bank',
-- pnl_treatment='income', category='customer_payment', conn_include_income) using
-- the SAME predicate as the Revenue total. UNION ALL (not OR) keeps each branch on
-- its own partial index — the gateway branch on idx_txn_posted_payments (119) and
-- the bank branch on idx_txn_bank_income (123) — so this does NOT reintroduce the
-- seq-scan blow-up that OR across two ledgers would cause (the 117→119 perf saga).
--
-- conn_include_income is now required on the gateway branch too, to match _dm_gross
-- (post-091) and the Revenue universe. It defaults true, so existing PG data is
-- unaffected; only a connector with include-income OFF is (correctly) excluded.
--
-- NOTE: both branches sum CREDITS only (like the gateway gross), so the ranking is a
-- customer's positive contribution; rare bank clawbacks (debits) are not netted — this
-- is a ranking, not a to-the-rupee reconciliation of the Revenue total.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function revenue_top_customers(p_org uuid, p_from date, p_to date, p_limit int default 5)
returns table(customer_key text, name text, revenue numeric, txns bigint)
language sql stable as $$
  with base as (
    -- Gateway payments (PG) — uses idx_txn_posted_payments (119)
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
      and t.conn_include_income
      and t.transaction_date >= p_from and t.transaction_date <= p_to
      and coalesce(t.category,'') <> 'settlement'
      and coalesce(t.source,'') !~ '_(payout|settlement)$'
    union all
    -- Customer invoices collected directly into the bank — uses idx_txn_bank_income (123)
    select
      case when lower(coalesce(t.metadata->>'email','')) in ('','na','n/a')
           then null else lower(t.metadata->>'email') end            as email,
      case when coalesce(trim(t.counterparty_name),'') = ''
           then null else t.counterparty_name end                    as cname,
      coalesce(t.amount_base, t.amount)                              as amt
    from transactions t
    where t.org_id = p_org
      and t.type = 'credit' and t.ledger = 'bank'
      and t.pnl_treatment = 'income' and t.category = 'customer_payment'
      and t.conn_include_income
      and t.status in ('completed','refunded')
      and t.transaction_date >= p_from and t.transaction_date <= p_to
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
    -- Gateway payments (PG)
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
      and t.conn_include_income
      and t.transaction_date >= p_from and t.transaction_date <= p_to
      and coalesce(t.category,'') <> 'settlement'
      and coalesce(t.source,'') !~ '_(payout|settlement)$'
    union all
    -- Customer invoices collected directly into the bank
    select
      case when lower(coalesce(t.metadata->>'email','')) in ('','na','n/a')
           then null else lower(t.metadata->>'email') end            as email,
      case when coalesce(trim(t.counterparty_name),'') = ''
           then null else t.counterparty_name end                    as cname
    from transactions t
    where t.org_id = p_org
      and t.type = 'credit' and t.ledger = 'bank'
      and t.pnl_treatment = 'income' and t.category = 'customer_payment'
      and t.conn_include_income
      and t.status in ('completed','refunded')
      and t.transaction_date >= p_from and t.transaction_date <= p_to
  )
  select count(distinct coalesce(email, lower(cname)))
  from base
  where coalesce(email, cname) is not null;
$$;

grant execute on function revenue_top_customers(uuid, date, date, int),
                          revenue_paying_customers(uuid, date, date)
  to authenticated, anon, service_role;
