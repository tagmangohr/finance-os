-- ============================================================
-- FILE: 047_card_detail_columns.sql
-- Surface Mercury credit-card detail that we already ingest into transactions.raw
-- but never extracted into queryable columns.
--
-- Mercury attaches `details.creditCardInfo` to every real card swipe:
--   { paymentMethod: "Credit Card ••5330", email: "hasan@aifiesta.ai", id: <cardId> }
-- (Bill-payments and international-fee lines have no creditCardInfo — those stay null.)
--
-- (1) two columns; (2) one-time backfill from the stored raw payload; (3) an index
-- for the per-card filter. New rows are populated on insert by the normalizer.
-- ============================================================

alter table transactions add column if not exists card_last4  text;
alter table transactions add column if not exists card_holder text;

-- Backfill from raw for every bank row that carries card info.
update transactions
   set card_last4  = substring(raw->'details'->'creditCardInfo'->>'paymentMethod' from '(\d{4})\s*$'),
       card_holder = raw->'details'->'creditCardInfo'->>'email'
 where ledger = 'bank'
   and raw->'details'->'creditCardInfo' is not null
   and card_last4 is null;

-- Filter/group support (per-org, per-card).
create index if not exists idx_transactions_card
  on transactions (org_id, card_last4)
  where card_last4 is not null;
