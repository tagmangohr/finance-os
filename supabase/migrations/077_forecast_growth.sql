-- 077_forecast_growth.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Persist per-line growth-rate overrides for the Forecast (and the Variance plan).
--
-- Defaults still come from each line's recent actual trend (computed live in
-- lib/forecast). This table only stores the user's manual overrides so an edited
-- Growth /mo % survives refresh and is reflected in the Variance plan. One row per
-- (org, line). line_slug is '__gross__' | '__refunds__' | '__pg_fees__' | a
-- ledger_categories slug. Deleting a row reverts that line to the trend default.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists forecast_growth (
  org_id     uuid        not null,
  line_slug  text        not null,
  growth_pct numeric     not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, line_slug)
);

grant select on forecast_growth to authenticated, anon, service_role;
grant insert, update, delete on forecast_growth to service_role;
