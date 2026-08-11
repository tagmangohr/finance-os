-- 058_materialized_metric_rollups.sql
-- The dashboard metric RPCs aggregate the full transactions table on every load.
-- At ~412k rows (post Razorpay backfill) that exceeds the 8s statement timeout,
-- so /dashboard 500s right after login. Plain views/indexes still scan every row.
--
-- Fix: PRECOMPUTE the monthly revenue rollups into materialized views (grain =
-- org × month, and org × currency × month). The dashboard then reads a few dozen
-- precomputed rows instead of scanning 412k — instant, and it stays fast no
-- matter how large transactions grows. metrics_monthly_range /
-- revenue_by_currency_range are repointed to read the rollups. Same canonical,
-- null-safe revenue definition as before (credit + payments ledger, terminal
-- status, excluding settlement/payout transfers).

-- ── Monthly gross revenue (org × month) ─────────────────────────────────────
create materialized view if not exists mv_metrics_monthly as
  select
    t.org_id,
    date_trunc('month', t.transaction_date)::date as month,
    coalesce(sum(coalesce(t.amount_base, t.amount)), 0) as gross_revenue
  from transactions t
  where t.type = 'credit' and t.ledger = 'payments'
    and t.status in ('completed','refunded')
    and coalesce(t.category,'') <> 'settlement'
    and coalesce(t.source,'') !~ '_(payout|settlement)$'
  group by 1, 2;
create unique index if not exists uq_mv_metrics_monthly on mv_metrics_monthly (org_id, month);

-- ── Revenue by currency (org × currency × month) ────────────────────────────
create materialized view if not exists mv_rev_currency_monthly as
  select
    t.org_id,
    t.currency,
    date_trunc('month', t.transaction_date)::date as month,
    coalesce(sum(t.amount), 0) as original,
    coalesce(sum(coalesce(t.amount_base, t.amount)), 0) as inr
  from transactions t
  where t.type = 'credit' and t.ledger = 'payments'
    and t.status in ('completed','refunded')
    and coalesce(t.category,'') <> 'settlement'
    and coalesce(t.source,'') !~ '_(payout|settlement)$'
  group by 1, 2, 3;
create unique index if not exists uq_mv_rev_currency_monthly on mv_rev_currency_monthly (org_id, currency, month);

-- ── Repoint the ranged RPCs to read the rollups (month-grain, instant) ──────
create or replace function metrics_monthly_range(p_org uuid, p_from date, p_to date)
returns table(month date, gross_revenue numeric)
language sql stable as $$
  select m.month, m.gross_revenue
  from mv_metrics_monthly m
  where m.org_id = p_org
    and m.month >= date_trunc('month', p_from)::date
    and m.month <= p_to
  order by m.month;
$$;

create or replace function revenue_by_currency_range(p_org uuid, p_from date, p_to date)
returns table(currency text, original numeric, inr numeric)
language sql stable as $$
  select c.currency, coalesce(sum(c.original),0) as original, coalesce(sum(c.inr),0) as inr
  from mv_rev_currency_monthly c
  where c.org_id = p_org
    and c.month >= date_trunc('month', p_from)::date
    and c.month <= p_to
  group by c.currency;
$$;

-- Refresh helper — call after ingests + a periodic cron. Non-concurrent (brief
-- lock, ~seconds) so it is transaction-safe from a function; a cron may instead
-- run `refresh materialized view concurrently …` directly for zero read-blocking.
create or replace function refresh_metric_rollups()
returns void language plpgsql security definer as $$
begin
  refresh materialized view mv_metrics_monthly;
  refresh materialized view mv_rev_currency_monthly;
end $$;

grant select on mv_metrics_monthly, mv_rev_currency_monthly to authenticated, anon, service_role;
grant execute on function refresh_metric_rollups() to service_role;
grant execute on function metrics_monthly_range(uuid, date, date),
                         revenue_by_currency_range(uuid, date, date)
  to authenticated, anon, service_role;
