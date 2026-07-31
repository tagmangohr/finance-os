-- ============================================================
-- FILE: 043_compliance_legal_category.sql
-- Add a distinct "Compliance / Legal" expense category (separate from
-- "Professional Services", which stays for accounting/consulting). Data-only —
-- the dropdown, AI categorizer and reports read the taxonomy from the DB, so no
-- code deploy is needed. A few high-precision seed rules; the AI layer handles
-- the long tail now that the category exists.
-- ============================================================

insert into ledger_categories (org_id, slug, label, treatment, flow, sort, is_system) values
  (null, 'compliance_legal', 'Compliance / Legal', 'expense', 'out', 72, true)
on conflict do nothing;

insert into category_rules (org_id, match_field, match_type, match_value, category_slug, priority, source) values
  (null, 'counterparty', 'contains', 'legal',              'compliance_legal', 25, 'seed'),
  (null, 'counterparty', 'contains', 'law firm',           'compliance_legal', 25, 'seed'),
  (null, 'counterparty', 'contains', 'attorney',           'compliance_legal', 25, 'seed'),
  (null, 'counterparty', 'contains', 'advocate',           'compliance_legal', 25, 'seed'),
  (null, 'counterparty', 'contains', 'compliance',         'compliance_legal', 25, 'seed'),
  (null, 'counterparty', 'contains', 'company secretary',  'compliance_legal', 25, 'seed'),
  (null, 'counterparty', 'contains', 'notary',             'compliance_legal', 25, 'seed'),
  (null, 'description',  'contains', 'roc filing',         'compliance_legal', 25, 'seed'),
  (null, 'description',  'contains', 'trademark',          'compliance_legal', 25, 'seed'),
  (null, 'description',  'contains', 'legal fees',         'compliance_legal', 25, 'seed')
on conflict do nothing;
