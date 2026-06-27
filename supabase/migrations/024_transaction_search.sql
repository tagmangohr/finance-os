-- 024: full search across every transaction field, including all of metadata.
--
-- Search only covered external_id/description/counterparty_name, so order ids, raw
-- payment ids, UTR/RRN, email, etc. (which live in metadata JSONB) were unsearchable.
-- We add a single `search_text` blob = those columns + the ENTIRE metadata text,
-- maintained by a trigger, with a pg_trgm GIN index so ILIKE '%term%' is fast and
-- ANY value (and any field a future connector adds) is searchable — no per-field code.

create extension if not exists pg_trgm;

alter table transactions add column if not exists search_text text;

create or replace function transactions_set_search_text() returns trigger
  language plpgsql as $$
begin
  new.search_text :=
    coalesce(new.external_id, '') || ' ' ||
    coalesce(new.description, '') || ' ' ||
    coalesce(new.counterparty_name, '') || ' ' ||
    coalesce(new.metadata::text, '');
  return new;
end $$;

drop trigger if exists trg_transactions_search_text on transactions;
create trigger trg_transactions_search_text
  before insert or update on transactions
  for each row execute function transactions_set_search_text();

-- Backfill existing rows (one-time). If this times out on a very large table, run it
-- in id ranges; it's a plain text concat so it's normally quick.
update transactions set search_text =
  coalesce(external_id, '') || ' ' ||
  coalesce(description, '') || ' ' ||
  coalesce(counterparty_name, '') || ' ' ||
  coalesce(metadata::text, '');

create index if not exists idx_transactions_search_trgm
  on transactions using gin (search_text gin_trgm_ops);
