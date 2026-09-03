-- 101_category_rules_counterparty_scope.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- ROOT FIX for the categorization cascade.
--
-- BUG: a manual "remember" rule was keyed on the transaction DESCRIPTION alone.
-- That over-matches whenever the description is a generic memo shared by many
-- merchants. On Mercury, EVERY outgoing transfer carries the identical string
-- "Send Money transaction initiated on Mercury" and the real payee lives in
-- counterparty_name — so categorizing ONE "SMNY and Associates" row propagated the
-- category to 78 rows across 35 unrelated merchants (Rohit Jain, LAMAYURU, CSC …)
-- that merely shared that memo, and the stored rule kept re-applying it to newly
-- synced rows. (Tagmango/NEFT was unaffected: its descriptions carry a unique
-- reference number, so "exact description" matched exactly one row.)
--
-- FIX: scope a remembered description rule to its COUNTERPARTY. A composite
-- (counterparty + description) exact rule keeps "ANTHROPIC CLAUDE TEAM" vs "…SUB"
-- separate (same cp, different desc) AND keeps SMNY vs Rohit Jain separate (same
-- desc, different cp). It can only ever match FEWER rows than description alone,
-- never more — so it cannot reintroduce any collapse.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Optional counterparty scope on a rule. NULL = unscoped (legacy single-field
--    rules keep their original behaviour).
alter table category_rules add column if not exists match_counterparty text;

-- 2) The uniqueness guard must now include the counterparty scope, so the SAME
--    description can carry independent rules per counterparty. NULL collapses to ''
--    so unscoped rules stay unique among themselves and are unaffected.
drop index if exists uq_category_rules_org_field_value;
create unique index if not exists uq_category_rules_org_field_value
  on category_rules (
    coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid),
    match_field,
    match_type,
    lower(match_value),
    lower(coalesce(match_counterparty, ''))
  );

-- 3) Neutralize the EXISTING over-matching rules so the bug cannot re-fire on newly
--    synced rows. This removes ONLY manual description rules whose description is
--    actually shared by transactions of MORE THAN ONE counterparty (a description
--    that maps 1:1 to a single merchant is harmless and is kept). Transaction rows
--    are NOT touched — only the sticky rule that would auto-re-apply. Any genuinely
--    wanted memory is recreated as a properly-scoped composite rule the next time
--    that merchant is categorized.
delete from category_rules cr
where cr.source = 'manual'
  and cr.match_field = 'description'
  and cr.match_type = 'exact'
  and cr.match_counterparty is null
  and (
    select count(distinct lower(coalesce(t.counterparty_name, '')))
    from transactions t
    where t.org_id = cr.org_id
      and t.ledger = 'bank'
      and lower(t.description) = lower(cr.match_value)
  ) > 1;
