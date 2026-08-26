-- 096_txn_summary_rollup.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY: /api/transactions/summary (the Payments explorer's four cards + source
-- dropdown + net/credits/debits/fees) calls transactions_summary_groups (052),
-- which GROUP-BYs and SUMs over the raw transactions table live. On the large
-- payments ledger (Fiesta ≈ 454k rows) that aggregate scans the wide `raw`-jsonb
-- heap and breaches the 8s statement timeout for any non-trivial window (measured:
-- 8–12s → the cards silently fail to load). The 095 partial index fixed the row
-- COUNT (index-only), but a grouped SUM of amount_base + metadata.fee cannot be
-- served from an index — it needs a precomputed aggregate.
--
-- FIX (exact + scalable, mirrors the 068 dashboard-rollup pattern): a trigger-
-- maintained rollup at (org, day, connector, source, category, status, type) grain
-- holding the three measures the card logic needs — cnt, Σ base-INR, Σ fee-INR.
-- transactions_summary_groups is rewritten to read this rollup (instant, exact) for
-- the common no-search case, falling back to the original live scan ONLY when a
-- free-text search term is present (naturally narrow). Numbers are byte-for-byte the
-- same as 052 — the reduction in TS (categorizeSource / POSTED_TRANSACTION_STATUSES
-- / dispute handling) is unchanged; only the source of the grouped rows moves from a
-- live scan to the rollup.
--
-- Scope matches 052 exactly: NON-BANK rows only (ledger <> 'bank', i.e. payments +
-- sales). Failed rows are kept (the disputes card needs them). Null-date rows are
-- included only when NO date filter is applied (reproduces 052's null-date NULL-
-- comparison semantics), stored under a sentinel day.
--
-- Isolated from the working 068 dashboard rollup: its own helpers, table, trigger
-- and rebuild — so a mistake here can never corrupt dashboard metrics.
--
-- SAFE TO RUN AS A NORMAL MIGRATION (no CONCURRENTLY, runs inside a transaction).
-- The final `select rebuild_txn_summary_rollup();` sets statement_timeout=0 for the
-- one-time backfill so it can't time out.
-- ─────────────────────────────────────────────────────────────────────────────

-- Sentinel for null transaction_date rows (kept out of every real date range).
-- 0001-01-01 sorts before any real date, so `day >= p_from` always excludes it.

-- ── Immutable per-row helpers (single source of truth: trigger == rebuild) ──────
-- Row participates in the payments summary iff it is not a bank-ledger row.
create or replace function _ts_included(r transactions) returns boolean language sql immutable as $$
  select coalesce(r.ledger::text, '') <> 'bank';
$$;
-- Base amount in INR (amount_base, else amount).
create or replace function _ts_base(r transactions) returns numeric language sql immutable as $$
  select coalesce(r.amount_base, r.amount, 0);
$$;
-- Fee in INR — prefer metadata.fee, fall back to metadata.fees; only a clean numeric
-- string counts (a stray non-numeric value must not break the aggregate); FX-convert
-- non-INR rows via fx_rate. Identical to 052's inline expression.
create or replace function _ts_fee(r transactions) returns numeric language sql immutable as $$
  select case
    when coalesce(r.metadata->>'fee', r.metadata->>'fees') ~ '^-?[0-9]+(\.[0-9]+)?$'
      then (coalesce(r.metadata->>'fee', r.metadata->>'fees'))::numeric
           * case when r.currency <> 'INR' then coalesce(r.fx_rate, 1) else 1 end
    else 0
  end;
$$;

-- ── Rollup table ───────────────────────────────────────────────────────────────
-- category/status can be null on a row; stored as '' sentinels so they can sit in
-- the primary key, and mapped back to null on read via nullif().
create table if not exists rollup_txn_summary_day (
  org_id       uuid    not null,
  day          date    not null,              -- transaction_date, or 0001-01-01 for null-date rows
  connector_id uuid    not null,
  source       text    not null,
  category     text    not null default '',
  status       text    not null default '',
  type         text    not null,
  cnt          bigint  not null default 0,
  sum_base     numeric not null default 0,
  sum_fee      numeric not null default 0,
  primary key (org_id, day, connector_id, source, category, status, type)
);
create index if not exists idx_rollup_txn_summary_org_day
  on rollup_txn_summary_day (org_id, day);

-- Security: unlike the 068/059 rollups (which grant SELECT to authenticated/anon
-- with no RLS — a cross-org read of aggregate financials via PostgREST), this table
-- is NOT directly readable by app users. RLS-on with no policy denies everyone
-- except the table owner and service_role; the only app read path is the
-- security-definer function below, which scopes by p_org (the API validates the
-- caller may read that org before calling).
alter table rollup_txn_summary_day enable row level security;

-- ── Applier (idempotent signed upsert; prunes rows that net back to empty) ───────
create or replace function _ts_apply(
  p_org uuid, p_day date, p_conn uuid, p_source text, p_cat text, p_status text, p_type text,
  d_cnt bigint, d_base numeric, d_fee numeric
) returns void language plpgsql as $$
begin
  if d_cnt = 0 and d_base = 0 and d_fee = 0 then return; end if;
  insert into rollup_txn_summary_day as s
    (org_id, day, connector_id, source, category, status, type, cnt, sum_base, sum_fee)
  values (p_org, p_day, p_conn, p_source, coalesce(p_cat,''), coalesce(p_status,''), p_type, d_cnt, d_base, d_fee)
  on conflict (org_id, day, connector_id, source, category, status, type) do update set
    cnt = s.cnt + excluded.cnt, sum_base = s.sum_base + excluded.sum_base, sum_fee = s.sum_fee + excluded.sum_fee;
  -- Keep the table from accumulating all-zero rows after churn.
  delete from rollup_txn_summary_day s
   where s.org_id = p_org and s.day = p_day and s.connector_id = p_conn and s.source = p_source
     and s.category = coalesce(p_cat,'') and s.status = coalesce(p_status,'') and s.type = p_type
     and s.cnt = 0 and s.sum_base = 0 and s.sum_fee = 0;
end $$;

-- ── Trigger: apply -OLD then +NEW (only non-bank rows contribute) ───────────────
-- security definer: the rollup table is locked down (no authenticated DML), so the
-- trigger must run with the owner's rights to write it — otherwise a transactions
-- insert/update from any non-service role would fail. It only ever writes derived
-- aggregates of the very row being changed.
create or replace function trg_txn_summary_rollup() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if TG_OP in ('UPDATE','DELETE') and _ts_included(OLD) then
    perform _ts_apply(OLD.org_id, coalesce(OLD.transaction_date, date '0001-01-01'), OLD.connector_id,
      OLD.source::text, OLD.category::text, OLD.status::text, OLD.type::text,
      -1, -_ts_base(OLD), -_ts_fee(OLD));
  end if;
  if TG_OP in ('INSERT','UPDATE') and _ts_included(NEW) then
    perform _ts_apply(NEW.org_id, coalesce(NEW.transaction_date, date '0001-01-01'), NEW.connector_id,
      NEW.source::text, NEW.category::text, NEW.status::text, NEW.type::text,
      1, _ts_base(NEW), _ts_fee(NEW));
  end if;
  return null;
end $$;
drop trigger if exists trg_txn_summary_rollup on transactions;
create trigger trg_txn_summary_rollup after insert or update or delete on transactions
  for each row execute function trg_txn_summary_rollup();

-- ── Full rebuild (initial populate + safety net) ────────────────────────────────
create or replace function rebuild_txn_summary_rollup() returns void language plpgsql security definer as $$
begin
  set local statement_timeout = 0;
  truncate rollup_txn_summary_day;
  insert into rollup_txn_summary_day (org_id, day, connector_id, source, category, status, type, cnt, sum_base, sum_fee)
    select t.org_id, coalesce(t.transaction_date, date '0001-01-01'), t.connector_id,
           t.source::text, coalesce(t.category::text,''), coalesce(t.status::text,''), t.type::text,
           count(*), coalesce(sum(_ts_base(t)),0), coalesce(sum(_ts_fee(t)),0)
    from transactions t
    where _ts_included(t)
    group by 1,2,3,4,5,6,7;
end $$;

-- ── Read RPC (SAME shape/semantics as 052; reads the rollup unless searching) ────
create or replace function transactions_summary_groups(
  p_org       uuid,
  p_connector uuid    default null,
  p_source    text    default null,
  p_type      text    default null,
  p_from      date    default null,
  p_to        date    default null,
  p_search    text    default null
)
returns table (source text, category text, status text, type text, cnt bigint, sum_base numeric, sum_fee numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_search is null then
    -- Fast path: no free-text search → read the precomputed rollup. Null-date rows
    -- (sentinel 0001-01-01) are included only when BOTH date bounds are null, exactly
    -- reproducing 052's NULL-comparison behaviour for a null transaction_date.
    return query
      select s.source, nullif(s.category,'') as category, nullif(s.status,'') as status, s.type,
             sum(s.cnt)::bigint as cnt, coalesce(sum(s.sum_base),0) as sum_base, coalesce(sum(s.sum_fee),0) as sum_fee
      from rollup_txn_summary_day s
      where s.org_id = p_org
        and (p_connector is null or s.connector_id = p_connector)
        and (p_source    is null or s.source = p_source)
        and (p_type      is null or s.type   = p_type)
        and (
          case
            when s.day = date '0001-01-01' then (p_from is null and p_to is null)
            else (p_from is null or s.day >= p_from) and (p_to is null or s.day <= p_to)
          end
        )
      group by s.source, nullif(s.category,''), nullif(s.status,''), s.type;
  else
    -- Search path: the original live aggregate (naturally narrow — a text term
    -- matches few rows). Same numbers, just not precomputed.
    return query
      select t.source::text, t.category::text, t.status::text, t.type::text,
             count(*) as cnt,
             coalesce(sum(coalesce(t.amount_base, t.amount)), 0) as sum_base,
             coalesce(sum(
               case
                 when coalesce(t.metadata->>'fee', t.metadata->>'fees') ~ '^-?[0-9]+(\.[0-9]+)?$'
                   then (coalesce(t.metadata->>'fee', t.metadata->>'fees'))::numeric
                        * case when t.currency <> 'INR' then coalesce(t.fx_rate, 1) else 1 end
                 else 0
               end
             ), 0) as sum_fee
      from transactions t
      where t.org_id = p_org
        and coalesce(t.ledger::text, '') <> 'bank'
        and (p_connector is null or t.connector_id = p_connector)
        and (p_source    is null or t.source::text = p_source)
        and (p_type      is null or t.type::text   = p_type)
        and (p_from      is null or t.transaction_date >= p_from)
        and (p_to        is null or t.transaction_date <= p_to)
        and t.search_text ilike '%' || p_search || '%'
      group by t.source::text, t.category::text, t.status::text, t.type::text;
  end if;
end $$;

-- ── Grants (locked down — see the RLS note above) ───────────────────────────────
-- No SELECT for authenticated/anon: the table is reachable only via the
-- security-definer read function. service_role (jobs, backfills, diagnostics) keeps
-- full access.
grant select, insert, update, delete on rollup_txn_summary_day to service_role;
grant execute on function rebuild_txn_summary_rollup() to service_role;
grant execute on function transactions_summary_groups(uuid, uuid, text, text, date, date, text)
  to authenticated, service_role;

select rebuild_txn_summary_rollup();
