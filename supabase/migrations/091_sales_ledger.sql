-- 091_sales_ledger.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- SALES ledger: a new, flexible revenue ledger fed by Google Sheet / Excel / CSV
-- connectors. Sales rows are stored in the SAME transactions table (ledger='sales')
-- so they ride the exact scalable sync pipeline as bank/payments (staging →
-- apply_sheet_chunk → per-org rollup rebuild → cleanup, all timeout-free). Every
-- source column is preserved in metadata.raw, so the Sales tab can break sales down
-- by ANY column without a schema change.
--
-- Revenue integration (per product decision): sales credits COUNT as revenue in the
-- P&L / Dashboard / Revenue, ADDITIVELY to PG revenue — the user connects a given
-- revenue stream once (gateway OR sheet), so there's no double-count. This is done
-- by adding a `sales` branch to the shared income helpers, exactly mirroring how the
-- `payments` branch works, and gated by the SAME per-connector include_income toggle.
--
-- SAFETY: on apply this changes NO existing number — there are zero ledger='sales'
-- rows yet, and the helper edits are purely additive (an OR branch for a ledger that
-- doesn't exist until a sales sheet is connected). Once sales rows land, the sheet
-- sync's per-org rebuild recomputes the rollups with these helpers.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Allow the new ledger value ────────────────────────────────────────────
alter table transactions drop constraint if exists transactions_ledger_check;
alter table transactions add constraint transactions_ledger_check
  check (ledger in ('payments', 'bank', 'sales'));

-- ── 2. Fast partial index for the Sales tab (mirrors the bank index) ─────────
create index if not exists idx_transactions_sales
  on transactions (org_id, transaction_date desc)
  where ledger = 'sales';

-- ── 3. Add `sales` to the shared INCOME helpers (additive, toggle-gated) ─────
-- Each is the 085 body with ledger='payments' widened to ('payments','sales').
-- Sales rows are credits with status='completed' and no category/fees, so the
-- existing settlement/payout guards pass them through unchanged.
create or replace function _dm_gross(r transactions) returns numeric language sql immutable as $$
  select case when _dm_excluded(r) then 0 when r.conn_include_income and r.type='credit' and r.ledger in ('payments','sales') and r.status in ('completed','refunded') then _dm_base(r) else 0 end; $$;
create or replace function _dm_completed_amt(r transactions) returns numeric language sql immutable as $$
  select case when _dm_excluded(r) then 0 when r.conn_include_income and r.type='credit' and r.ledger in ('payments','sales') and r.status='completed' then _dm_base(r) else 0 end; $$;

create or replace function _rev_contrib(r transactions) returns numeric language sql immutable as $$
  select case
    when r.conn_include_income and r.type = 'credit' and r.ledger in ('payments','sales')
     and r.status in ('completed','refunded')
     and coalesce(r.category,'') <> 'settlement'
     and coalesce(r.source,'') !~ '_(payout|settlement)$'
    then coalesce(r.amount_base, r.amount) else 0 end;
$$;
create or replace function _rev_qual(r transactions) returns bigint language sql immutable as $$
  select case
    when r.conn_include_income and r.type = 'credit' and r.ledger in ('payments','sales')
     and r.status in ('completed','refunded')
     and coalesce(r.category,'') <> 'settlement'
     and coalesce(r.source,'') !~ '_(payout|settlement)$'
    then 1 else 0 end;
$$;
create or replace function _rev_orig(r transactions) returns numeric language sql immutable as $$
  select case
    when r.conn_include_income and r.type = 'credit' and r.ledger in ('payments','sales')
     and r.status in ('completed','refunded')
     and coalesce(r.category,'') <> 'settlement'
     and coalesce(r.source,'') !~ '_(payout|settlement)$'
    then r.amount else 0 end;
$$;
create or replace function _cf_in(r transactions) returns numeric language sql immutable as $$
  select case
    when r.conn_include_income and r.status in ('completed','refunded')
     and coalesce(r.source,'') !~ '_(payout|settlement)$'
     and ( (r.ledger = 'bank'     and r.pnl_treatment in ('income','expense') and r.type = 'credit')
        or (r.ledger = 'payments' and r.type = 'credit' and coalesce(r.category,'') <> 'settlement')
        or (r.ledger = 'sales'    and r.type = 'credit') )
    then coalesce(r.amount_base, r.amount) else 0 end;
$$;

-- Revenue-by-gateway: give sales its own bucket instead of splitting the source
-- label (e.g. "google_sheets" → "google"). Weighted by _dm_gross, which now
-- includes sales, so sales revenue shows under a clean "sales" gateway.
create or replace function _rev_gateway(r transactions) returns text language sql immutable as $$
  select case
    when r.ledger = 'sales' then 'sales'
    when r.source is null then 'other'
    when r.source ~~ 'app_store%' then 'app_store'
    else split_part(r.source::text, '_', 1)
  end;
$$;

-- ── 4. Sales tab read RPCs (single indexed passes — scale to 100k+ sales rows) ─
-- Available breakdown dimensions = the union of source-column names present on the
-- org's sales rows (sampled from the most recent 3000 — columns are consistent
-- per source, so a sample is representative and cheap).
create or replace function sales_dimensions(p_org uuid)
returns text[] language sql stable as $$
  select coalesce(array_agg(distinct k order by k), '{}')
  from (
    select jsonb_object_keys(coalesce(t.metadata->'raw', '{}'::jsonb)) as k
    from (
      select metadata from transactions
      where org_id = p_org and ledger = 'sales'
      order by transaction_date desc
      limit 3000
    ) t
  ) keys
  where k is not null and k <> '';
$$;

-- Everything the Sales tab renders in ONE indexed pass: cards (total / orders),
-- monthly trend, and the top-20 breakdown by the chosen dimension (p_dim, a key in
-- metadata.raw). Respects the per-connector include_income toggle so it ties to the
-- revenue contribution. amount = credits − debits (returns), in INR base.
create or replace function sales_overview_agg(p_org uuid, p_from date, p_to date, p_dim text)
returns jsonb language sql stable as $$
  with base as (
    select transaction_date, type, coalesce(amount_base, amount, 0) as amt, metadata
    from transactions
    where org_id = p_org and ledger = 'sales' and conn_include_income
      and transaction_date >= p_from and transaction_date <= p_to
  ),
  signed as (
    select transaction_date, metadata,
      case when type = 'credit' then amt else -amt end as v,
      case when type = 'credit' then 1 else 0 end as is_order
    from base
  ),
  tot as (
    select coalesce(sum(v), 0) as total, coalesce(sum(is_order), 0) as orders, count(*) as txn_count from signed
  ),
  bymonth as (
    select to_char(date_trunc('month', transaction_date), 'YYYY-MM') as month, sum(v) as amount
    from signed group by 1
  ),
  bydim as (
    select coalesce(nullif(metadata->'raw'->>p_dim, ''), '—') as value, sum(v) as amount, count(*) as cnt
    from signed
    where p_dim is not null and p_dim <> ''
    group by 1
    having sum(v) <> 0
    order by amount desc
    limit 20
  )
  select jsonb_build_object(
    'total',       (select total from tot),
    'orders',      (select orders from tot),
    'txnCount',    (select txn_count from tot),
    'byMonth',     coalesce((select jsonb_agg(jsonb_build_object('month', month, 'amount', amount) order by month) from bymonth), '[]'::jsonb),
    'byDimension', coalesce((select jsonb_agg(jsonb_build_object('value', value, 'amount', amount, 'count', cnt) order by amount desc) from bydim), '[]'::jsonb)
  );
$$;

grant execute on function sales_dimensions(uuid) to authenticated, anon, service_role;
grant execute on function sales_overview_agg(uuid, date, date, text) to authenticated, anon, service_role;

-- ── 5. Keep the P&L Revenue DRILL consistent with the (now sales-inclusive) line ─
-- The Revenue line includes sales, so drilling it must too — else the drill sums to
-- less than the line. Verbatim from 085 + sales added to the revenue branch, and
-- sales rows grouped by their source tab (account_type) instead of a split source.
create or replace function pnl_drill_groups(
  p_org  uuid,
  p_key  text,
  p_from date,
  p_to   date,
  p_limit int default 50
)
returns table(name text, amount numeric, txn_count bigint)
language sql
stable
security invoker
as $$
  with base as (
    select
      case
        when p_key in ('revenue','refunds','__pg_fees__') then
          case
            when t.ledger = 'sales' then coalesce(nullif(t.account_type, ''), 'Sales')
            when t.source like 'app_store%' then 'app_store'
            else coalesce(nullif(split_part(coalesce(t.source, ''), '_', 1), ''), '—')
          end
        else coalesce(nullif(t.counterparty_name, ''), '—')
      end as name,
      case
        when p_key = '__pg_fees__' then _pnl_fee(t)
        when p_key not in ('revenue','refunds') and t.type = 'credit' then -coalesce(t.amount_base, t.amount, 0)
        else coalesce(t.amount_base, t.amount, 0)
      end as amt
    from transactions t
    where t.org_id = p_org
      and t.transaction_date >= p_from
      and t.transaction_date <= p_to
      and not _dm_excluded(t)
      and case
        when p_key = 'revenue' then
          t.conn_include_income and t.type = 'credit' and t.ledger in ('payments','sales') and t.status in ('completed','refunded')
        when p_key = 'refunds' then
          t.conn_include_income and t.ledger = 'payments' and (
            (t.type = 'debit' and t.category = 'refund') or (t.type = 'credit' and t.status = 'refunded')
          )
        when p_key = '__pg_fees__' then
          t.conn_include_expense and t.status in ('completed','refunded') and _pnl_fee(t) <> 0
        when p_key = 'uncategorized' then
          t.conn_include_expense and t.status in ('completed','refunded')
          and ((t.ledger = 'bank' and t.pnl_treatment = 'expense') or (t.ledger = 'payments' and t.type = 'debit'))
          and coalesce(t.category, '') = ''
        else
          t.conn_include_expense and t.status in ('completed','refunded')
          and ((t.ledger = 'bank' and t.pnl_treatment = 'expense') or (t.ledger = 'payments' and t.type = 'debit'))
          and t.category = p_key
      end
  ),
  grouped as (
    select name, sum(amt) as amount, count(*) as txn_count
    from base
    group by name
    having sum(amt) <> 0
  )
  select name, amount, txn_count
  from grouped
  order by abs(amount) desc, txn_count desc
  limit p_limit;
$$;

grant execute on function pnl_drill_groups(uuid, text, date, date, int) to authenticated, anon, service_role;

-- ── 6. Keep the metric-strip views consistent (they don't use the helpers) ───
-- getMetricData reads vw_metrics_monthly / vw_metrics_totals directly (raw scan,
-- not the helper-based rollups). They hardcode ledger='payments' for revenue, so
-- without this the customizable metric strip would show revenue EXCLUDING sales
-- while the P&L / Revenue / Dashboard include it. Redefine (verbatim from 044) with
-- the revenue/inflow/count filters widened to ('payments','sales'); refunds and
-- expense stay payments/bank. Additive — no sales rows exist yet, so no change on
-- apply. (Payment-health volumes stay PG-only: "payment health" is a gateway concept.)
create or replace view vw_metrics_monthly as
select
  t.org_id,
  date_trunc('month', t.transaction_date)::date as month,
  coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'credit' and t.ledger in ('payments','sales')
      and t.status in ('completed', 'refunded')), 0) as gross_revenue,
  coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'debit' and t.ledger = 'payments' and t.category = 'refund'), 0)
  + coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'credit' and t.ledger = 'payments' and t.status = 'refunded'), 0) as refunds,
  coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'debit' and t.status in ('completed', 'refunded') and (
        (t.ledger = 'bank' and t.pnl_treatment = 'expense')
        or (t.ledger = 'payments' and coalesce(t.category, '') not in ('refund', 'dispute', 'settlement'))
    )), 0)
  - coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'credit' and t.status in ('completed', 'refunded') and t.ledger = 'bank' and t.pnl_treatment = 'expense'), 0) as expense_total,
  count(*) filter (where t.type = 'credit' and t.ledger in ('payments','sales') and t.status = 'completed') as txn_count,
  count(distinct lower(t.counterparty_name))
    filter (where t.type = 'credit' and t.ledger in ('payments','sales') and t.status = 'completed'
      and coalesce(t.counterparty_name, '') <> '') as paying_customers
from transactions t
where t.transaction_date <= current_date
  and t.transaction_date >= (date_trunc('month', current_date) - interval '13 months')::date
  and coalesce(t.category, '') <> 'settlement'
  and coalesce(t.source, '') !~* '(settlement|payout)'
group by t.org_id, date_trunc('month', t.transaction_date);

create or replace view vw_metrics_totals as
select
  t.org_id,
  coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'credit' and t.ledger in ('payments','sales') and t.status = 'completed'), 0) as lifetime_inflow,
  coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'debit' and t.status in ('completed', 'refunded') and (
        (t.ledger = 'bank' and t.pnl_treatment = 'expense')
        or (t.ledger = 'payments' and coalesce(t.category, '') not in ('dispute', 'settlement'))
    )), 0)
  - coalesce(sum(coalesce(t.amount_base, t.amount))
    filter (where t.type = 'credit' and t.status in ('completed', 'refunded') and t.ledger = 'bank' and t.pnl_treatment = 'expense'), 0) as lifetime_outflow
from transactions t
where t.transaction_date <= current_date
  and coalesce(t.category, '') <> 'settlement'
  and coalesce(t.source, '') !~* '(settlement|payout)'
group by t.org_id;

grant select on vw_metrics_monthly, vw_metrics_totals to authenticated, anon, service_role;
