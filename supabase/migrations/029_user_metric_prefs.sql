-- ============================================================
-- FILE: 029_user_metric_prefs.sql
-- Per-user, per-org dashboard metric preferences.
--
-- Each user chooses which metrics to pin to the top strip, in what order, and how
-- many to show (5 / 10 / …). Stored per (user, org) so the same person can have a
-- different top strip in each org they belong to. If this table is absent (migration
-- not yet applied), the app falls back to a sensible default pin set — a missing
-- table must never break the dashboard.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_metric_prefs (
  user_id            uuid        NOT NULL REFERENCES auth.users (id)          ON DELETE CASCADE,
  org_id             uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  pinned_metric_keys text[]      NOT NULL DEFAULT '{}',   -- ordered list of metric keys to show
  visible_count      int         NOT NULL DEFAULT 6,      -- how many of the pinned metrics to render
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id)
);

ALTER TABLE public.user_metric_prefs ENABLE ROW LEVEL SECURITY;

-- A user may read/write only their own preferences. No cross-table reference, so
-- no recursion risk (see CLAUDE.md). Owners/admins don't need to see others' prefs.
DROP POLICY IF EXISTS user_metric_prefs_self ON public.user_metric_prefs;
CREATE POLICY user_metric_prefs_self ON public.user_metric_prefs
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_metric_prefs TO authenticated;
