-- ============================================================
-- FILE: 016_one_org_per_owner.sql
-- Root-cause fix for "connectors keep disappearing".
--
-- Owners accumulated MULTIPLE organization rows from the old slug-collision
-- retry loop (e.g. demo@financeos.app ended up with 6 orgs). Connectors,
-- transactions and drive connections are pinned to ONE org (the oldest), but
-- the app resolved "the org" inconsistently across pages — some used
-- .single() (which ERRORS on >1 row), some picked a different org — so data
-- attached to the real org appeared to vanish after every deploy.
--
-- This migration:
--   1. Collapses each owner down to a single org by deleting DUPLICATE,
--      EMPTY orgs (keeping the OLDEST — that is where all real data lives).
--      An org that still holds data is NEVER deleted; if one exists, step 2
--      fails loudly so it can be reviewed by hand instead of silently
--      cascade-deleting financial data.
--   2. Adds a UNIQUE(owner_id) constraint so an owner can never again have
--      more than one organization.
-- ============================================================

-- ── 1. Remove duplicate EMPTY orgs, keep the oldest per owner ────────────────
WITH ranked AS (
  SELECT
    id,
    owner_id,
    row_number() OVER (PARTITION BY owner_id ORDER BY created_at ASC) AS rn
  FROM organizations
)
DELETE FROM organizations o
USING ranked r
WHERE o.id = r.id
  AND r.rn > 1
  AND NOT EXISTS (SELECT 1 FROM connectors          x WHERE x.org_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM transactions        x WHERE x.org_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM drive_connections   x WHERE x.org_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM entities            x WHERE x.org_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM invoices            x WHERE x.org_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM financial_snapshots x WHERE x.org_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM intelligence_alerts x WHERE x.org_id = o.id)
  AND NOT EXISTS (SELECT 1 FROM org_members         x WHERE x.org_id = o.id);

-- ── 2. Enforce one organization per owner from now on ────────────────────────
-- If this fails with a unique_violation, an owner still has >1 org with data
-- under it — investigate and merge manually rather than deleting.
ALTER TABLE organizations
  ADD CONSTRAINT organizations_owner_id_key UNIQUE (owner_id);
