-- 112_pnl_review_flags.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- "Mark for review" on P&L line items → an accounting review queue.
--
-- While reviewing cost lines, anyone with P&L access can flag a specific vendor /
-- line item for a period (e.g. "AWS — Aug 26") so the accounting team can look at
-- it and optimise the spend. A flag captures WHO raised it, a note, and a status
-- (open → resolved). The team works the open queue and marks each resolved.
--
-- A flag points at a (drill_key, party, period) tuple — the same coordinates the
-- line-items endpoint (111) and the drill route use — NOT a single transaction,
-- so "AWS in August" is one flag regardless of how many transactions sit behind
-- it. Denormalised display snapshots (labels, amount) are stored so the queue
-- renders without re-deriving the grid.
--
-- Access model mirrors api_keys (079): NO direct client access — the table is
-- granted ONLY to service_role and reached exclusively through the gated API
-- route (app/api/pnl/review), which authorises org + 'pnl' page access first.
-- RLS is additionally enabled with no policy as defence-in-depth (so even a
-- future stray grant can't expose it).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists pnl_review_flags (
  id               uuid        primary key default gen_random_uuid(),
  org_id           uuid        not null references organizations (id) on delete cascade,
  drill_key        text        not null,            -- category slug | '__pg_fees__' | 'revenue' | 'refunds' | 'income:<slug>'
  party            text        not null,            -- vendor / gateway stem / 'bank:<payer>' ('—' = unnamed)
  party_label      text,                            -- display label snapshot
  category_label   text,                            -- e.g. 'AI Model' (the P&L row label)
  period_from      date        not null,
  period_to        date        not null,
  period_label     text,                            -- e.g. 'Aug 26' / 'FY 2026-27' / 'Total'
  amount_snapshot  numeric,                         -- line-item ₹ at flag time (queue display)
  note             text,
  status           text        not null default 'open' check (status in ('open', 'resolved')),
  created_by       uuid        references auth.users (id) on delete set null,
  created_by_email text,                            -- who raised it (display snapshot)
  created_at       timestamptz not null default now(),
  resolved_by      uuid        references auth.users (id) on delete set null,
  resolved_by_email text,
  resolved_at      timestamptz
);

-- Queue reads: open flags for an org, newest first.
create index if not exists idx_pnl_flags_org_status on pnl_review_flags (org_id, status, created_at desc);

-- At most ONE open flag per (org, line item, period) — re-flagging the same
-- vendor+period is a no-op / update, never a duplicate. Resolved rows are exempt
-- (history is kept), so the same item can be re-flagged after being resolved.
create unique index if not exists uq_pnl_flag_open
  on pnl_review_flags (org_id, drill_key, party, period_from, period_to)
  where status = 'open';

alter table pnl_review_flags enable row level security;  -- no policy ⇒ deny all; service_role bypasses RLS
grant select, insert, update, delete on pnl_review_flags to service_role;
