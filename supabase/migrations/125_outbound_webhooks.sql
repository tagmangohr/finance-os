-- 125_outbound_webhooks.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Outbound (egress) webhooks: forward every PG payment (and its later status
-- changes) to an external endpoint, so a downstream dashboard mirrors our data in
-- near-real-time. This is the push counterpart to the pull Partner API (079) and
-- the inbound gateway_events archive (071).
--
-- Design:
--   • webhook_endpoints  — per-org config (one endpoint to start): url, encrypted
--     HMAC secret, enabled flag, event-type allowlist, forward-only cutoff.
--   • webhook_deliveries — the OUTBOX + audit: one row per (endpoint, event). A cron
--     worker drains it (POST + HMAC + retries), so delivery never blocks ingest.
--   • enqueue trigger on transactions — the single chokepoint. Fires on INSERT and on
--     a status change, so every ingest path (PG webhooks, imports, backfills, manual)
--     is covered without touching each one. Scope is PG payment CREDITS only.
--
-- Reliability: at-least-once. The worker retries the SAME row (stable event_id) with
-- backoff; the receiver dedupes on event_id and upserts on transaction_id.
--
-- Perf: the trigger short-circuits on the first two cheap guards (ledger/type) for the
-- vast majority of writes, and only fires for status-column updates (`update of status`),
-- so non-payment rows and enrichment updates cost nothing.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists webhook_endpoints (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  url          text not null,
  secret       text not null,                 -- AES-256-GCM ciphertext (CONNECTOR_ENC_KEY)
  description  text,
  enabled      boolean not null default true,
  event_types  text[] not null default '{payment.created,payment.updated,payment.refunded}',
  enabled_at   timestamptz not null default now(),  -- forward-only cutoff (vs transaction_date)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_webhook_endpoints_org on webhook_endpoints(org_id) where enabled;

create table if not exists webhook_deliveries (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  endpoint_id     uuid not null references webhook_endpoints(id) on delete cascade,
  event_id        text not null,                 -- stable dedupe key sent to the receiver
  transaction_id  uuid,                          -- soft ref (row may be repriced later)
  event_type      text not null,                 -- payment.created | payment.updated | payment.refunded
  tx_snapshot     jsonb not null,                -- transaction state AT event time (minus bulky raw)
  status          text not null default 'pending', -- pending|delivering|delivered|failed|dead
  attempts        int  not null default 0,
  max_attempts    int  not null default 12,
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  response_code   int,
  delivered_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists idx_webhook_deliveries_drain on webhook_deliveries(next_attempt_at) where status in ('pending','failed');
create index if not exists idx_webhook_deliveries_org   on webhook_deliveries(org_id, created_at desc);
create unique index if not exists uq_webhook_deliveries_event on webhook_deliveries(endpoint_id, event_id);

-- ── Enqueue trigger: single chokepoint for every write path into transactions ──
-- SECURITY DEFINER so its INSERT into webhook_deliveries always succeeds, even when
-- the transaction was written under a user session (deliveries has no INSERT policy —
-- only the worker/trigger ever writes it).
create or replace function enqueue_webhook_delivery() returns trigger
  language plpgsql security definer set search_path = public as $$
declare ep record; evt text;
begin
  -- Scope: PG payment credits only, excluding settlement/payout transfers.
  if NEW.ledger <> 'payments' or NEW.type <> 'credit' then return NEW; end if;
  if _dm_excluded(NEW) then return NEW; end if;

  if TG_OP = 'INSERT' then
    evt := case when NEW.status = 'refunded' then 'payment.refunded' else 'payment.created' end;
  else                                        -- UPDATE: only a real status change
    if OLD.status is not distinct from NEW.status then return NEW; end if;
    evt := case when NEW.status = 'refunded' then 'payment.refunded' else 'payment.updated' end;
  end if;

  for ep in
    select id from webhook_endpoints
    where org_id = NEW.org_id
      and enabled
      and NEW.transaction_date >= enabled_at::date   -- forward-only (by payment date)
      and evt = any(event_types)
  loop
    insert into webhook_deliveries (org_id, endpoint_id, event_id, transaction_id, event_type, tx_snapshot)
    values (NEW.org_id, ep.id, 'evt_' || replace(gen_random_uuid()::text, '-', ''),
            NEW.id, evt, to_jsonb(NEW) - 'raw')
    on conflict (endpoint_id, event_id) do nothing;
  end loop;
  return NEW;
end $$;

drop trigger if exists trg_enqueue_webhook on transactions;
create trigger trg_enqueue_webhook
  after insert or update of status on transactions
  for each row execute function enqueue_webhook_delivery();

-- ── Claim RPC: the delivery worker grabs a batch atomically (no double-send) ───
-- Picks due rows (pending/failed, plus 'delivering' whose lease expired = a crashed
-- worker), marks them delivering, bumps attempts, and sets a short lease on
-- next_attempt_at so a crash auto-recovers. FOR UPDATE SKIP LOCKED lets overlapping
-- cron runs work in parallel without grabbing the same row.
create or replace function claim_webhook_deliveries(p_limit int default 50, p_lease interval default interval '5 minutes')
returns setof webhook_deliveries language plpgsql as $$
begin
  return query
  update webhook_deliveries d
     set status = 'delivering', attempts = d.attempts + 1, next_attempt_at = now() + p_lease
   where d.id in (
     select id from webhook_deliveries
     where next_attempt_at <= now()
       and (status in ('pending','failed') or status = 'delivering')  -- 'delivering' only re-claimed once its lease lapsed (next_attempt_at<=now)
     order by next_attempt_at asc
     limit greatest(p_limit, 1)
     for update skip locked)
   returning d.*;
end $$;
grant execute on function claim_webhook_deliveries(int, interval) to service_role;

-- ── RLS: owner + active admins manage webhooks (matches how API keys are managed) ─
-- SECURITY DEFINER helper (same pattern as auth_is_org_owner in 015) so the policy
-- never recurses through org_members ↔ organizations.
create or replace function auth_can_manage_org(p_org_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from organizations where id = p_org_id and owner_id = auth.uid())
      or exists (select 1 from org_members
                 where org_id = p_org_id and user_id = auth.uid()
                   and role = 'admin' and status = 'active');
$$;

alter table webhook_endpoints  enable row level security;
alter table webhook_deliveries enable row level security;

-- Endpoints: owner/admin do full CRUD (via the user client → RLS-enforced).
create policy webhook_endpoints_manage on webhook_endpoints for all
  using      (auth_can_manage_org(org_id))
  with check (auth_can_manage_org(org_id));

-- Deliveries: owner/admin READ only. Writes are done by the trigger + the service-role
-- worker (retry route uses the service client), so there is intentionally no user
-- INSERT/UPDATE/DELETE policy — the outbox can't be forged or tampered from a session.
create policy webhook_deliveries_read on webhook_deliveries for select
  using (auth_can_manage_org(org_id));

grant select, insert, update, delete on webhook_endpoints to authenticated;
grant select on webhook_deliveries to authenticated;
grant all on webhook_endpoints, webhook_deliveries to service_role;
