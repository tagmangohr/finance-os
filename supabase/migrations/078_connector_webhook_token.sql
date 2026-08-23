-- 078_connector_webhook_token.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Per-connector webhook token so each account of the same gateway gets a DISTINCT
-- webhook URL (…/api/webhooks/razorpay?c=<token>). With 4 Razorpay accounts the
-- one endpoint can't tell them apart; the token routes each inbound event to the
-- exact connector, and the signature is then verified with that connector's own
-- webhook secret. Existing token-less URLs keep working (fallback matching).
--
-- gen_random_uuid() is volatile, so adding the column backfills every existing row
-- with its own unique token automatically.
-- ─────────────────────────────────────────────────────────────────────────────

alter table connectors add column if not exists webhook_token uuid not null default gen_random_uuid();
create unique index if not exists idx_connectors_webhook_token on connectors (webhook_token);
