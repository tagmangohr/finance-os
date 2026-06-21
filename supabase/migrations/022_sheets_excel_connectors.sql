-- Add the Google Sheets and online-Excel link connectors to the connector_type
-- enum. Without this, inserting a connector of these types fails with
-- "invalid input value for enum connector_type". Mirrors migrations 009 / 011.
--
-- Note: ALTER TYPE ... ADD VALUE must run outside a transaction and the new
-- value can't be used in the same transaction it's added in — run these
-- statements as-is in the Supabase SQL editor (not wrapped in BEGIN/COMMIT).

ALTER TYPE connector_type ADD VALUE IF NOT EXISTS 'google_sheets';
ALTER TYPE connector_type ADD VALUE IF NOT EXISTS 'excel';
