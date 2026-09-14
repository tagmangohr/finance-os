-- 115_pnl_lineitems_rollup.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Make the Expand (line-items) feature FAST and scalable.
--
-- 111-114 computed every line on demand from raw transactions. For a payments-
-- heavy org that means scanning ~42k CREDIT rows PER MONTH (212k for a FY) twice —
-- once for revenue-by-gateway, once for fees-by-gateway — which blows the 8s
-- statement timeout (measured: 4.5s for ONE month, timeout for 3+). The expense
-- branch made it worse by scanning ALL rows (incl. those 42k credits) to find a
-- few hundred debits.
--
-- Fix (same pattern the Analytics revenue split already uses, 080):
--   • REVENUE by gateway  ← rollup_revenue_gateway_day (080, sums _dm_gross)   ← fast
--   • FEES by gateway     ← rollup_fees_gateway_day (NEW here, sums _pnl_fee)  ← fast
--   • everything else (expense by vendor, refunds, bank-collected revenue, other
--     income) stays raw but is TINY: those are debits / bank rows only (hundreds
--     per month), and the expense branch is pre-filtered to a safe SUPERSET of
--     _dm_expense_m (debits OR bank-expense rows — covers its debit branch AND its
--     bank-expense reversal-credit branch, so the Mornell tie-out holds) instead
--     of scanning the 42k credits.
--
-- TIE-OUT is preserved exactly: the gateway rollups sum the SAME helpers as the
-- P&L totals (_dm_gross, _pnl_fee) per day, so Σ(gateways) ≡ the Revenue / Fees
-- row; the raw branches reuse _dm_expense_m / _dm_refunds / _dm_base unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Fees-by-gateway rollup (org × day × gateway), mirroring 080 ───────────────
create table if not exists rollup_fees_gateway_day (
  org_id  uuid    not null,
  day     date    not null,
  gateway text    not null,
  amount  numeric not null default 0,
  primary key (org_id, day, gateway)
);
create index if not exists idx_rollup_fees_gw_day on rollup_fees_gateway_day (org_id, day);

create or replace function _fees_gw_apply(p_org uuid, p_day date, p_gw text, p_delta numeric) returns void language plpgsql as $$
begin
  if p_delta = 0 or p_gw is null or p_gw = '' then return; end if;
  insert into rollup_fees_gateway_day as m (org_id, day, gateway, amount)
  values (p_org, p_day, p_gw, p_delta)
  on conflict (org_id, day, gateway) do update set amount = m.amount + excluded.amount;
end $$;

-- Trigger: apply −OLD then +NEW fee contribution per gateway (reuses _pnl_fee +
-- _rev_gateway, so it stays perfectly in step with the __pg_fees__ P&L line).
create or replace function trg_fees_gw_rollup() returns trigger language plpgsql as $$
begin
  if TG_OP in ('UPDATE','DELETE') and OLD.transaction_date is not null then
    perform _fees_gw_apply(OLD.org_id, OLD.transaction_date, _rev_gateway(OLD), -_pnl_fee(OLD));
  end if;
  if TG_OP in ('INSERT','UPDATE') and NEW.transaction_date is not null then
    perform _fees_gw_apply(NEW.org_id, NEW.transaction_date, _rev_gateway(NEW),  _pnl_fee(NEW));
  end if;
  return null;
end $$;
drop trigger if exists trg_fees_gw_rollup on transactions;
create trigger trg_fees_gw_rollup after insert or update or delete on transactions for each row execute function trg_fees_gw_rollup();

create or replace function rebuild_fees_gateway_rollups() returns void language plpgsql security definer as $$
begin
  set local statement_timeout = 0;
  truncate rollup_fees_gateway_day;
  insert into rollup_fees_gateway_day (org_id, day, gateway, amount)
    select t.org_id, t.transaction_date, _rev_gateway(t), sum(_pnl_fee(t))
    from transactions t
    where t.transaction_date is not null
    group by t.org_id, t.transaction_date, _rev_gateway(t)
    having sum(_pnl_fee(t)) <> 0;
end $$;

-- Fold the new rollup into the nightly self-heal (098) so it can't silently drift.
create or replace function rebuild_all_rollups() returns void language plpgsql security definer as $$
begin
  set local statement_timeout = 0;
  perform rebuild_metric_rollups();
  perform rebuild_dash_rollups();
  perform rebuild_pnl_rollups();
  perform rebuild_revenue_gateway_rollups();
  perform rebuild_fees_gateway_rollups();     -- 115: rollup_fees_gateway_day
  perform rebuild_txn_summary_rollup();
end $$;

-- ── Rewritten line-items reader: rollups for the heavy gateway lines, tiny raw
--    scans for the rest. Pure SQL/STABLE (no SET → runs under the caller's timeout,
--    which is now ample because nothing scans the credit mass). ────────────────
create or replace function pnl_lineitems_monthly(p_org uuid, p_from date, p_to date)
returns table(month date, drill_key text, party text, amount numeric, txn_count bigint)
language sql stable as $$
  -- REVENUE by gateway (rollup — fast). txn_count is unknown at rollup grain → 0;
  -- clicking the line still opens the real transaction list with its true count.
  select date_trunc('month', day)::date, 'revenue', gateway, sum(amount), 0::bigint
  from rollup_revenue_gateway_day
  where org_id = p_org and day >= p_from and day <= p_to
  group by 1, 3
  having sum(amount) <> 0

  union all
  -- PAYMENT GATEWAY FEES by gateway (rollup — fast).
  select date_trunc('month', day)::date, '__pg_fees__', gateway, sum(amount), 0::bigint
  from rollup_fees_gateway_day
  where org_id = p_org and day >= p_from and day <= p_to
  group by 1, 3
  having sum(amount) <> 0

  union all
  -- EXPENSES by vendor (raw; safe superset of _dm_expense_m: debits OR bank-expense
  -- rows — covers the reversal-credit branch. NEVER narrow this to type='debit').
  select date_trunc('month', t.transaction_date)::date,
         _pnl_expense_cat(t),
         coalesce(nullif(btrim(t.counterparty_name), ''), '—'),
         sum(_dm_expense_m(t)),
         count(*) filter (where _dm_expense_m(t) <> 0)
  from transactions t
  where t.org_id = p_org
    and t.transaction_date >= p_from and t.transaction_date <= p_to
    and (t.type = 'debit' or (t.ledger = 'bank' and t.pnl_treatment = 'expense'))
  group by 1, 2, 3
  having sum(_dm_expense_m(t)) <> 0

  union all
  -- REFUNDS by gateway (raw; debits only — _dm_refunds is debit·refund).
  select date_trunc('month', t.transaction_date)::date,
         'refunds',
         case when t.source like 'app_store%' then 'app_store'
              else coalesce(nullif(split_part(coalesce(t.source, ''), '_', 1), ''), '—') end,
         sum(_dm_refunds(t)),
         count(*) filter (where _dm_refunds(t) <> 0)
  from transactions t
  where t.org_id = p_org
    and t.transaction_date >= p_from and t.transaction_date <= p_to
    and t.type = 'debit'
  group by 1, 2, 3
  having sum(_dm_refunds(t)) <> 0

  union all
  -- GROSS REVENUE bank-collected customer payments, by payer (raw; bank rows only).
  select date_trunc('month', t.transaction_date)::date,
         'revenue',
         'bank:' || coalesce(nullif(btrim(t.counterparty_name), ''), '—'),
         sum(case when t.type = 'credit' then _dm_base(t) else -_dm_base(t) end),
         count(*)
  from transactions t
  where t.org_id = p_org
    and t.transaction_date >= p_from and t.transaction_date <= p_to
    and t.ledger = 'bank' and t.pnl_treatment = 'income'
    and t.category = 'customer_payment'
    and t.conn_include_income
    and t.status in ('completed', 'refunded')
  group by 1, 2, 3
  having sum(case when t.type = 'credit' then _dm_base(t) else -_dm_base(t) end) <> 0

  union all
  -- OTHER INCOME (non customer_payment bank income) by payer, per category (raw).
  select date_trunc('month', t.transaction_date)::date,
         'income:' || coalesce(nullif(t.category, ''), 'other_income'),
         coalesce(nullif(btrim(t.counterparty_name), ''), '—'),
         sum(case when t.type = 'credit' then _dm_base(t) else -_dm_base(t) end),
         count(*)
  from transactions t
  where t.org_id = p_org
    and t.transaction_date >= p_from and t.transaction_date <= p_to
    and t.ledger = 'bank' and t.pnl_treatment = 'income'
    and t.conn_include_income
    and t.status in ('completed', 'refunded')
    and coalesce(nullif(t.category, ''), 'other_income') <> 'customer_payment'
  group by 1, 2, 3
  having sum(case when t.type = 'credit' then _dm_base(t) else -_dm_base(t) end) <> 0;
$$;

-- Initial populate of the new rollup.
select rebuild_fees_gateway_rollups();

-- Grants: readers are service_role-only (103 baseline); the API route holds the
-- service client and checks 'pnl' access.
grant select                         on rollup_fees_gateway_day to service_role;
grant insert, update, delete         on rollup_fees_gateway_day to service_role;
grant execute on function rebuild_fees_gateway_rollups() to service_role;
revoke execute on function pnl_lineitems_monthly(uuid, date, date) from anon, authenticated;
grant  execute on function pnl_lineitems_monthly(uuid, date, date) to service_role;
