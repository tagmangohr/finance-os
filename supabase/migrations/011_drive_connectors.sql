-- ============================================================
-- FILE: 011_drive_connectors.sql
-- Cloud Drive connectors — Google Drive & OneDrive
-- ============================================================

-- ── Extend connector_type ENUM ────────────────────────────────────────────────
ALTER TYPE connector_type ADD VALUE IF NOT EXISTS 'google_drive';
ALTER TYPE connector_type ADD VALUE IF NOT EXISTS 'onedrive';

-- ── drive_connections ─────────────────────────────────────────────────────────
-- One record per OAuth connection (one Google Drive account per org,
-- one OneDrive account per org).  Stores refresh/access tokens.
-- connector_id points to the matching row in `connectors` so that
-- transactions.connector_id (NOT NULL FK) can reference it cleanly.

CREATE TABLE drive_connections (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  connector_id    uuid        NOT NULL REFERENCES connectors   (id) ON DELETE CASCADE,
  provider        text        NOT NULL CHECK (provider IN ('google_drive', 'onedrive')),
  access_token    text        NOT NULL,
  refresh_token   text,
  token_expiry    timestamptz,
  account_email   text,
  account_name    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider)
);

-- ── drive_folders ─────────────────────────────────────────────────────────────
-- A tracked folder pasted by the user.  One connection → many folders.

CREATE TABLE drive_folders (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL REFERENCES organizations    (id) ON DELETE CASCADE,
  connection_id       uuid        NOT NULL REFERENCES drive_connections (id) ON DELETE CASCADE,
  provider_folder_id  text        NOT NULL,
  folder_name         text        NOT NULL DEFAULT '',
  folder_url          text        NOT NULL,
  last_scan_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, provider_folder_id)
);

-- ── drive_files ───────────────────────────────────────────────────────────────
-- Individual CSV / Excel files discovered inside a folder.
-- column_mapping stores the confirmed field-to-column JSON map.
-- last_etag tracks file change detection for auto-sync.

CREATE TABLE drive_files (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  folder_id           uuid        NOT NULL REFERENCES drive_folders (id) ON DELETE CASCADE,
  provider_file_id    text        NOT NULL,
  file_name           text        NOT NULL,
  mime_type           text,
  column_mapping      jsonb,
  mapping_confirmed   boolean     NOT NULL DEFAULT false,
  last_etag           text,
  last_modified_at    text,
  row_count           integer,
  last_sync_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (folder_id, provider_file_id)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX idx_drive_connections_org        ON drive_connections (org_id);
CREATE INDEX idx_drive_folders_connection     ON drive_folders     (connection_id);
CREATE INDEX idx_drive_folders_org            ON drive_folders     (org_id);
CREATE INDEX idx_drive_files_folder           ON drive_files       (folder_id);
CREATE INDEX idx_drive_files_org              ON drive_files       (org_id);
CREATE INDEX idx_drive_files_unsynced         ON drive_files       (org_id, last_sync_at)
  WHERE mapping_confirmed = true;

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE drive_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drive_connections_org_owner"
  ON drive_connections FOR ALL
  USING    (org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()));

ALTER TABLE drive_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drive_folders_org_owner"
  ON drive_folders FOR ALL
  USING    (org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()));

ALTER TABLE drive_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drive_files_org_owner"
  ON drive_files FOR ALL
  USING    (org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()))
  WITH CHECK (org_id IN (SELECT id FROM organizations WHERE owner_id = auth.uid()));
