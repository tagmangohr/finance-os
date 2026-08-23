-- 079_api_keys.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Org-scoped API keys for the partner Payments Search API (/api/v1/payments).
-- A partner's backend sends the key as `Authorization: Bearer <key>`; we resolve
-- the org from the key and run a read-only, search-only payments query.
--
-- Only a SHA-256 hash of the key is stored (the plaintext is shown once at
-- creation, never again). key_prefix is a short non-secret label for the UI.
-- Managed server-side (service client) behind an owner-only Settings screen.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists api_keys (
  id           uuid        primary key default gen_random_uuid(),
  org_id       uuid        not null references organizations (id) on delete cascade,
  name         text        not null,
  key_prefix   text        not null,               -- e.g. "fos_live_ab12" (display only)
  key_hash     text        not null unique,         -- sha256(full key), hex
  scopes       text[]      not null default '{payments:read}',
  created_by   uuid,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists idx_api_keys_org on api_keys (org_id);

grant select, insert, update, delete on api_keys to service_role;
