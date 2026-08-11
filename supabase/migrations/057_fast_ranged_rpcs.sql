-- 057_fast_ranged_rpcs.sql
-- FIX: the dashboard's metric RPCs timed out once the transactions table grew
-- (~412k rows for Fiesta after the Razorpay backfill). Root cause: a
-- case-insensitive, UNANCHORED regex `!~* '(settlement|payout)'` evaluated on
-- every row. The sibling cashflow RPC already used the cheap anchored form and
-- stayed fast. Switch metrics_monthly_range + revenue_by_currency_range to the
-- same anchored `!~ '_(payout|settlement)$'` (correct: transfer sources always
-- end in _settlement/_payout, matching isTransferSource) and add a supporting
-- index. Brings both well under the statement timeout; the post-login dashboard
-- renders again.

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
    and coalesce(t.source,'') !~ '_(payout|settlement)$'
  group by 1
  order by 1;
$$;

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
    and coalesce(t.source,'') !~ '_(payout|settlement)$'
  group by t.currency;
$$;

grant execute on function metrics_monthly_range(uuid, date, date),
                         revenue_by_currency_range(uuid, date, date)
  to authenticated, anon, service_role;

-- Supporting index for org+date range aggregation (helps every ranged rollup and
-- the Payments summary as the table grows).
create index if not exists idx_transactions_org_date
  on transactions (org_id, transaction_date);
