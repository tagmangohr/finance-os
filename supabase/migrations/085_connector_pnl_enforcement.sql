-- 085_connector_pnl_enforcement.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Enforce the per-connector include_income / include_expense toggles (084) across
-- EVERY metric — P&L, Dashboard, Analytics, Revenue, Cashflow — in one place.
--
-- How: the six metric rollups (059 revenue/cashflow, 068 dashboard, 073 P&L,
-- 080 gateway) all compute their contributions through a small set of SHARED,
-- IMMUTABLE helper functions (_dm_gross, _dm_expense_m, _pnl_fee, _rev_contrib,
-- _cf_in/out, …). Gate THOSE helpers on the connector flags and every rollup
-- respects the toggle automatically — no rollup table, trigger structure, or read
-- RPC changes. An immutable helper can't join, so the connector's flags are
-- DENORMALISED onto each transaction row (conn_include_income / conn_include_expense)
-- and the helpers read them off the row.
--
-- SAFETY — this migration changes NO numbers on apply: both columns default TRUE,
-- so every existing and new row is TRUE, and `... and r.conn_include_income` with
-- TRUE is identical to the old condition. The gating only bites once a toggle is
-- flipped OFF (which calls resync_connector_pnl_flags → re-stamps that connector's
-- rows + rebuilds). So no backfill and no rebuild are needed here.
--
-- Mapping:
--   include_income  gates revenue + refunds + disputes + cash inflow.
--   include_expense gates operating expense + PG fees + cash outflow.
--   (Operational COUNTS — completed/failed/pending — are left ungated; the toggle
--    is about income/expense money, not payment-health counts.)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Denormalised connector flags on each transaction ─────────────────────
alter table transactions add column if not exists conn_include_income  boolean not null default true;
alter table transactions add column if not exists conn_include_expense boolean not null default true;

-- Populate on INSERT from the owning connector (connector_id is immutable, so no
-- UPDATE path needed here — a toggle flip re-stamps via resync below). Cheap: one
-- PK lookup per insert. Rows with no connector keep the TRUE defaults.
create or replace function trg_txn_conn_flags() returns trigger language plpgsql as $$
begin
  if NEW.connector_id is not null then
    select c.include_income, c.include_expense
      into NEW.conn_include_income, NEW.conn_include_expense
      from connectors c where c.id = NEW.connector_id;
    NEW.conn_include_income  := coalesce(NEW.conn_include_income, true);
    NEW.conn_include_expense := coalesce(NEW.conn_include_expense, true);
  end if;
  return NEW;
end $$;
drop trigger if exists trg_txn_conn_flags on transactions;
create trigger trg_txn_conn_flags before insert on transactions for each row execute function trg_txn_conn_flags();

-- ── 2. Gate the shared helpers (INCOME side) ────────────────────────────────
create or replace function _dm_gross(r transactions) returns numeric language sql immutable as $$
  select case when _dm_excluded(r) then 0 when r.conn_include_income and r.type='credit' and r.ledger='payments' and r.status in ('completed','refunded') then _dm_base(r) else 0 end; $$;
create or replace function _dm_completed_amt(r transactions) returns numeric language sql immutable as $$
  select case when _dm_excluded(r) then 0 when r.conn_include_income and r.type='credit' and r.ledger='payments' and r.status='completed' then _dm_base(r) else 0 end; $$;
create or replace function _dm_refunds(r transactions) returns numeric language sql immutable as $$
  select case when _dm_excluded(r) then 0 when r.conn_include_income and r.ledger='payments' and ((r.type='debit' and r.category='refund') or (r.type='credit' and r.status='refunded')) then _dm_base(r) else 0 end; $$;
create or replace function _dm_dispute_amt(r transactions) returns numeric language sql immutable as $$
  select case when _dm_excluded(r) then 0 when r.conn_include_income and r.ledger='payments' and r.category='dispute' then _dm_base(r) else 0 end; $$;

create or replace function _rev_contrib(r transactions) returns numeric language sql immutable as $$
  select case
    when r.conn_include_income and r.type = 'credit' and r.ledger = 'payments'
     and r.status in ('completed','refunded')
     and coalesce(r.category,'') <> 'settlement'
     and coalesce(r.source,'') !~ '_(payout|settlement)$'
    then coalesce(r.amount_base, r.amount) else 0 end;
$$;
create or replace function _rev_qual(r transactions) returns bigint language sql immutable as $$
  select case
    when r.conn_include_income and r.type = 'credit' and r.ledger = 'payments'
     and r.status in ('completed','refunded')
     and coalesce(r.category,'') <> 'settlement'
     and coalesce(r.source,'') !~ '_(payout|settlement)$'
    then 1 else 0 end;
$$;
create or replace function _rev_orig(r transactions) returns numeric language sql immutable as $$
  select case
    when r.conn_include_income and r.type = 'credit' and r.ledger = 'payments'
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
        or (r.ledger = 'payments' and r.type = 'credit' and coalesce(r.category,'') <> 'settlement') )
    then coalesce(r.amount_base, r.amount) else 0 end;
$$;

-- ── 3. Gate the shared helpers (EXPENSE side) ───────────────────────────────
create or replace function _dm_expense_m(r transactions) returns numeric language sql immutable as $$
  select case when _dm_excluded(r) then 0 when r.conn_include_expense and r.type='debit' and ((r.ledger='bank' and r.pnl_treatment='expense') or (r.ledger='payments' and coalesce(r.category,'') not in ('refund','dispute','settlement'))) then _dm_base(r) else 0 end; $$;
create or replace function _dm_outflow_l(r transactions) returns numeric language sql immutable as $$
  select case when _dm_excluded(r) then 0 when r.conn_include_expense and r.type='debit' and ((r.ledger='bank' and r.pnl_treatment='expense') or (r.ledger='payments' and coalesce(r.category,'') not in ('dispute','settlement'))) then _dm_base(r) else 0 end; $$;
create or replace function _pnl_fee(r transactions) returns numeric language sql immutable as $$
  select case
    when _dm_excluded(r) then 0
    when not r.conn_include_expense then 0
    when r.status not in ('completed','refunded') then 0
    when coalesce(r.metadata->>'fee', r.metadata->>'fees') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (coalesce(r.metadata->>'fee', r.metadata->>'fees'))::numeric
           * case when r.currency <> 'INR' then coalesce(r.fx_rate, 1) else 1 end
    else 0 end;
$$;
create or replace function _cf_out(r transactions) returns numeric language sql immutable as $$
  select case
    when r.conn_include_expense and r.status in ('completed','refunded')
     and coalesce(r.source,'') !~ '_(payout|settlement)$'
     and ( (r.ledger = 'bank'     and r.pnl_treatment in ('income','expense') and r.type = 'debit')
        or (r.ledger = 'payments' and r.type = 'debit') )
    then coalesce(r.amount_base, r.amount) else 0 end;
$$;

-- ── 4. Skip-guard on the rollup triggers (avoids a per-row storm during the
--       bulk re-stamp in resync — see below). Bodies are otherwise verbatim. ──
create or replace function trg_txn_rollup() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.skip_rollup', true), '') = 'on' then return null; end if;
  if TG_OP in ('UPDATE','DELETE') and OLD.transaction_date is not null then
    perform _rollup_apply_rev_month(OLD.org_id, date_trunc('month', OLD.transaction_date)::date, -_rev_contrib(OLD), -_rev_qual(OLD));
    perform _rollup_apply_rev_cur(OLD.org_id, coalesce(OLD.currency,''), date_trunc('month', OLD.transaction_date)::date, -_rev_orig(OLD), -_rev_contrib(OLD));
    perform _rollup_apply_cf_day(OLD.org_id, OLD.transaction_date, -_cf_in(OLD), -_cf_out(OLD));
  end if;
  if TG_OP in ('INSERT','UPDATE') and NEW.transaction_date is not null then
    perform _rollup_apply_rev_month(NEW.org_id, date_trunc('month', NEW.transaction_date)::date, _rev_contrib(NEW), _rev_qual(NEW));
    perform _rollup_apply_rev_cur(NEW.org_id, coalesce(NEW.currency,''), date_trunc('month', NEW.transaction_date)::date, _rev_orig(NEW), _rev_contrib(NEW));
    perform _rollup_apply_cf_day(NEW.org_id, NEW.transaction_date, _cf_in(NEW), _cf_out(NEW));
  end if;
  return null;
end $$;

create or replace function trg_dash_rollup() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.skip_rollup', true), '') = 'on' then return null; end if;
  if TG_OP in ('UPDATE','DELETE') and OLD.transaction_date is not null then
    perform _dm_apply_daily(OLD.org_id, OLD.transaction_date,
      -_dm_gross(OLD), -_dm_completed_amt(OLD), -_dm_refunds(OLD), -_dm_expense_m(OLD), -_dm_outflow_l(OLD),
      -_dm_completed_cnt(OLD), -_dm_failed_cnt(OLD), -_dm_pending_cnt(OLD), -_dm_refunded_cnt(OLD), -_dm_dispute_cnt(OLD), -_dm_dispute_amt(OLD));
    perform _dm_apply_cust(OLD.org_id, OLD.transaction_date, _dm_cust_key(OLD), -1);
  end if;
  if TG_OP in ('INSERT','UPDATE') and NEW.transaction_date is not null then
    perform _dm_apply_daily(NEW.org_id, NEW.transaction_date,
      _dm_gross(NEW), _dm_completed_amt(NEW), _dm_refunds(NEW), _dm_expense_m(NEW), _dm_outflow_l(NEW),
      _dm_completed_cnt(NEW), _dm_failed_cnt(NEW), _dm_pending_cnt(NEW), _dm_refunded_cnt(NEW), _dm_dispute_cnt(NEW), _dm_dispute_amt(NEW));
    perform _dm_apply_cust(NEW.org_id, NEW.transaction_date, _dm_cust_key(NEW), 1);
  end if;
  return null;
end $$;

create or replace function trg_pnl_rollup() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.skip_rollup', true), '') = 'on' then return null; end if;
  if TG_OP in ('UPDATE','DELETE') and OLD.transaction_date is not null then
    perform _pnl_apply(OLD.org_id, OLD.transaction_date, _pnl_expense_cat(OLD), -_dm_expense_m(OLD));
    perform _pnl_apply(OLD.org_id, OLD.transaction_date, '__pg_fees__',        -_pnl_fee(OLD));
  end if;
  if TG_OP in ('INSERT','UPDATE') and NEW.transaction_date is not null then
    perform _pnl_apply(NEW.org_id, NEW.transaction_date, _pnl_expense_cat(NEW),  _dm_expense_m(NEW));
    perform _pnl_apply(NEW.org_id, NEW.transaction_date, '__pg_fees__',          _pnl_fee(NEW));
  end if;
  return null;
end $$;

create or replace function trg_rev_gw_rollup() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.skip_rollup', true), '') = 'on' then return null; end if;
  if TG_OP in ('UPDATE','DELETE') and OLD.transaction_date is not null then
    perform _rev_gw_apply(OLD.org_id, OLD.transaction_date, _rev_gateway(OLD), -_dm_gross(OLD));
  end if;
  if TG_OP in ('INSERT','UPDATE') and NEW.transaction_date is not null then
    perform _rev_gw_apply(NEW.org_id, NEW.transaction_date, _rev_gateway(NEW),  _dm_gross(NEW));
  end if;
  return null;
end $$;

-- ── 5. Toggle re-sync: re-stamp a connector's rows + rebuild every rollup ────
-- Called (backgrounded) after include_income/include_expense change on a connector.
-- The guard suppresses per-row rollup triggers during the bulk UPDATE (which could
-- be 100k+ rows), then a single full rebuild recomputes every rollup from the
-- freshly-stamped rows. security definer so the app's service role may run it.
create or replace function resync_connector_pnl_flags(p_conn uuid) returns void language plpgsql security definer as $$
declare v_inc boolean; v_exp boolean;
begin
  set local statement_timeout = 0;
  select include_income, include_expense into v_inc, v_exp from connectors where id = p_conn;
  if not found then return; end if;

  perform set_config('app.skip_rollup', 'on', true);   -- true = local to this txn
  update transactions
     set conn_include_income = v_inc, conn_include_expense = v_exp
   where connector_id = p_conn
     and (conn_include_income is distinct from v_inc or conn_include_expense is distinct from v_exp);
  perform set_config('app.skip_rollup', 'off', true);

  perform rebuild_metric_rollups();
  perform rebuild_dash_rollups();
  perform rebuild_pnl_rollups();
  perform rebuild_revenue_gateway_rollups();
end $$;

grant execute on function resync_connector_pnl_flags(uuid) to service_role;

-- ── 6. Gate the drill RPC so a cell's breakdown ties to the (gated) line ─────
-- Verbatim from 076 + a per-branch connector-flag guard: revenue/refunds follow
-- include_income, expenses/fees follow include_expense. With all flags TRUE this
-- is identical to 076.
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
          coalesce(nullif(
            case when t.source like 'app_store%' then 'app_store'
                 else split_part(coalesce(t.source, ''), '_', 1) end, ''), '—')
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
      and not _dm_excluded(t)                        -- drop settlements/payouts (matches the rollup)
      and case
        when p_key = 'revenue' then
          t.conn_include_income and t.type = 'credit' and t.ledger = 'payments' and t.status in ('completed','refunded')
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
