-- ─── Payments summary: DB-side aggregation ──────────────────────────────────
-- The Payments summary cards were computed by paginating EVERY matching row into
-- the API and summing in JS (1000 rows/round-trip). Over a long date range that
-- is tens of thousands of rows and dozens–hundreds of sequential round-trips,
-- which blows past the function timeout — the request 504s and the client keeps
-- the previous range's (stale) cards.
--
-- This function collapses all matching rows into a small grouped result set
-- (source × category × status × type) with the three aggregates the card logic
-- needs: row count, Σ base-INR amount, and Σ fee (FX-converted to INR). The API
-- then reduces those few dozen rows with the SAME locked helper logic
-- (categorizeSource / isTransferSource / POSTED_TRANSACTION_STATUSES), so the
-- numbers are identical — just computed in ONE fast query regardless of range.
--
-- Mirrors the filters of /api/transactions/summary. Bank-ledger (Mercury) rows
-- are excluded here, exactly as the Payments page requires. Failed rows are kept
-- in the output (the caller needs them for the disputes card) and filtered in TS.

create or replace function transactions_summary_groups(
  p_org       uuid,
  p_connector uuid    default null,
  p_source    text    default null,
  p_type      text    default null,
  p_from      date    default null,
  p_to        date    default null,
  p_search    text    default null
)
returns table (
  source   text,
  category text,
  status   text,
  type     text,
  cnt      bigint,
  sum_base numeric,
  sum_fee  numeric
)
language sql
stable
security invoker
as $$
  select
    t.source::text,
    t.category::text,
    t.status::text,
    t.type::text,
    count(*)                                                as cnt,
    coalesce(sum(coalesce(t.amount_base, t.amount)), 0)     as sum_base,
    -- Fee in INR: prefer metadata.fee, fall back to metadata.fees; only when the
    -- stored value is a clean number (guards against a stray non-numeric string
    -- breaking the whole aggregate). FX-convert non-INR rows via fx_rate.
    coalesce(sum(
      case
        when coalesce(t.metadata->>'fee', t.metadata->>'fees') ~ '^-?[0-9]+(\.[0-9]+)?$'
          then (coalesce(t.metadata->>'fee', t.metadata->>'fees'))::numeric
               * case when t.currency <> 'INR' then coalesce(t.fx_rate, 1) else 1 end
        else 0
      end
    ), 0)                                                   as sum_fee
  from transactions t
  where t.org_id = p_org
    and coalesce(t.ledger::text, '') <> 'bank'
    and (p_connector is null or t.connector_id = p_connector)
    and (p_source    is null or t.source::text = p_source)
    and (p_type      is null or t.type::text   = p_type)
    and (p_from      is null or t.transaction_date >= p_from)
    and (p_to        is null or t.transaction_date <= p_to)
    and (p_search    is null or t.search_text ilike '%' || p_search || '%')
  group by t.source::text, t.category::text, t.status::text, t.type::text;
$$;

grant execute on function transactions_summary_groups(uuid, uuid, text, text, date, date, text) to authenticated, service_role;
