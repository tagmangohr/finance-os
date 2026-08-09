-- 054_member_activity.sql
-- Lightweight per-member activity log (Phase 1 + key actions). Login recency is
-- read for free from Supabase auth.last_sign_in_at; this table records the
-- high-value actions: Payments searches, CSV exports, and permission changes.
create table if not exists member_activity (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  actor_user_id    uuid,
  actor_email      text,
  action           text not null,          -- 'search' | 'export' | 'permission_change' | 'member_added' | 'member_removed'
  target_member_id uuid,
  meta             jsonb not null default '{}',
  created_at       timestamptz not null default now()
);

create index if not exists idx_member_activity_org    on member_activity(org_id, created_at desc);
create index if not exists idx_member_activity_actor  on member_activity(actor_user_id, created_at desc);
create index if not exists idx_member_activity_target on member_activity(target_member_id, created_at desc);

alter table member_activity enable row level security;
-- Access is via the service client in admin-gated APIs only; no public policy needed.
