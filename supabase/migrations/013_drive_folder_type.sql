-- Add folder_type to drive_folders so each folder can be labelled as
-- sales/revenue, expenses, bank_statements, or general (default).
-- The label is forwarded to the normaliser to correct type inference for
-- files that only have a single unsigned amount column (e.g. an expense
-- sheet where every row is a positive debit).

ALTER TABLE drive_folders
  ADD COLUMN IF NOT EXISTS folder_type text NOT NULL DEFAULT 'general'
  CONSTRAINT drive_folders_type_check
    CHECK (folder_type IN ('sales', 'expenses', 'bank_statements', 'general'));
