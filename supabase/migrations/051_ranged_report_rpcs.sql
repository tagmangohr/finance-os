-- ============================================================
-- FILE: 051_ranged_report_rpcs.sql
-- Parameterized (org, from, to) versions of the report rollups, so the Revenue
-- and Cashflow pages can honor an arbitrary date-range filter while STILL
-- aggregating in Postgres (no raw-row drains). Same canonical, null-safe
-- classification as the fixed-window views (039/049/050).
--
-- SECURITY INVOKER (default) — called by the app's service client. Granted to
-- authenticated/anon/service_role, consistent with the sibling views.
-- ============================================================

-- Monthly gross revenue for an arbitrary range (revenue page + any month chart).
create or replace function metrics_monthly_range(p_org uuid, p_from date, p_to date)
returns table(month date, gross_revenue numeric)
language sql stable as $$
  select
    date_trunc('month', t.transaction_date)::date as month,
    coalesce(sum(coalesce(t.amount_base, t.amount)), 0) as gross_revenue
  from transactions t
  where t.org_id = p_org
    and t.type = 'credit' and t.ledger = 'payments'
    and t.status in ('completed','refunded')
    and t.transaction_date >= p_from and t.transaction_date <= p_to
    and coalesce(t.category,'') <> 'settlement'
    and coalesce(t.source,'') !~* '(settlement|payout)'
  group by 1
  order by 1;
$$;

-- Per-currency revenue for an arbitrary range (revenue page currency split).
create or replace function revenue_by_currency_range(p_org uuid, p_from date, p_to date)
returns table(currency text, original numeric, inr numeric)
language sql stable as $$
  select
    t.currency,
    coalesce(sum(t.amount), 0) as original,
    coalesce(sum(coalesce(t.amount_base, t.amount)), 0) as inr
  from transactions t
  where t.org_id = p_org
    and t.type = 'credit' and t.ledger = 'payments'
    and t.status in ('completed','refunded')
    and t.transaction_date >= p_from and t.transaction_date <= p_to
    and coalesce(t.category,'') <> 'settlement'
    and coalesce(t.source,'') !~* '(settlement|payout)'
  group by t.currency;
$$;

-- Daily inflow/outflow for an arbitrary range (cashflow page series). Mirrors the
-- app's classify(): transfer sources excluded; bank ledger only income/expense;
-- payments credit(non-settlement)=inflow, debit=outflow.
create or replace function cashflow_daily_range(p_org uuid, p_from date, p_to date)
returns table(date date, inflow numeric, outflow numeric)
language sql stable as $$
  select
    t.transaction_date as date,
    coalesce(sum(coalesce(t.amount_base, t.amount)) filter (where
      (t.ledger = 'bank' and t.pnl_treatment in ('income','expense') and t.type = 'credit')
      or (t.ledger = 'payments' and t.type = 'credit' and coalesce(t.category,'') <> 'settlement')
    ), 0) as inflow,
    coalesce(sum(coalesce(t.amount_base, t.amount)) filter (where
      (t.ledger = 'bank' and t.pnl_treatment in ('income','expense') and t.type = 'debit')
      or (t.ledger = 'payments' and t.type = 'debit')
    ), 0) as outflow
  from transactions t
  where t.org_id = p_org
    and t.status in ('completed','refunded')
    and t.transaction_date >= p_from and t.transaction_date <= p_to
    and coalesce(t.source,'') !~ '_(payout|settlement)$'
  group by t.transaction_date
  order by t.transaction_date;
$$;

grant execute on function metrics_monthly_range(uuid, date, date),
                         revenue_by_currency_range(uuid, date, date),
                         cashflow_daily_range(uuid, date, date)
  to authenticated, anon, service_role;
