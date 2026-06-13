-- ============================================================
-- FILE: 017_drop_owner_id_unique.sql
-- Removes the UNIQUE(owner_id) constraint on organizations.
--
-- An earlier, since-abandoned migration ("one org per owner") added
-- organizations_owner_id_key. That assumption was reversed when multi-org
-- became a feature (a CFO runs several verticals), but the constraint had
-- already been applied to production — so a second org for the same owner
-- failed with a 23505 that surfaced as "Could not generate a unique slug".
--
-- Multi-org REQUIRES multiple orgs per owner. Drop it for good. Idempotent.
-- ============================================================

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_owner_id_key;
