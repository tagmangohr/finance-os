-- ============================================================
-- FILE: 121_user_card_prefs.sql
-- Per-user, per-org, PER-TAB card preferences (order + hidden).
--
-- Generalises the Dashboard's "pick & drop" metric strip (029) to every tab that
-- shows metric cards (revenue, payments, analytics, bank, cashflow, …). Each user
-- can reorder the cards and hide the ones they don't want, independently on each
-- tab and in each org. If this table is absent (migration not applied), the app
-- falls back to the default card order with nothing hidden — a missing table must
-- never break a tab.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_card_prefs (
  user_id     uuid        NOT NULL REFERENCES auth.users (id)           ON DELETE CASCADE,
  org_id      uuid        NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  tab         text        NOT NULL,                 -- 'revenue' | 'payments' | 'analytics' | …
  card_order  text[]      NOT NULL DEFAULT '{}',    -- ordered card keys (visible + hidden)
  hidden      text[]      NOT NULL DEFAULT '{}',    -- keys the user has hidden
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id, tab)
);

ALTER TABLE public.user_card_prefs ENABLE ROW LEVEL SECURITY;

-- A user may read/write only their own preferences (no cross-table reference, so
-- no recursion risk). Nobody needs to see anyone else's card layout.
DROP POLICY IF EXISTS user_card_prefs_self ON public.user_card_prefs;
CREATE POLICY user_card_prefs_self ON public.user_card_prefs
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_card_prefs TO authenticated;
