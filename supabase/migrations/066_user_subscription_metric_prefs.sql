-- ============================================================
-- FILE: 066_user_subscription_metric_prefs.sql
-- Per-user, per-org SUBSCRIPTIONS-page metric preferences — same shape/pattern as
-- user_metric_prefs (029) but a separate table so the Subscriptions KPI strip is
-- customized independently of the Dashboard strip (different metric catalog, and no
-- PK change on the working dashboard table). Missing table falls back to defaults.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_subscription_metric_prefs (
  user_id            uuid        NOT NULL REFERENCES auth.users (id)           ON DELETE CASCADE,
  org_id             uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  pinned_metric_keys text[]      NOT NULL DEFAULT '{}',
  visible_count      int         NOT NULL DEFAULT 8,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id)
);

ALTER TABLE public.user_subscription_metric_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_subscription_metric_prefs_self ON public.user_subscription_metric_prefs;
CREATE POLICY user_subscription_metric_prefs_self ON public.user_subscription_metric_prefs
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_subscription_metric_prefs TO authenticated;
