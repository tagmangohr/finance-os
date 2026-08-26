-- 086_ai_tool_category.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Add "AI Tool" as an EXPENSE category — subscriptions to AI-powered tools/apps
-- (Cursor, GitHub Copilot, Perplexity, ChatGPT/Claude seats, etc.), distinct from
-- 'ai_model' (raw LLM/model API usage that powers the product = cost of revenue)
-- and 'software' (general SaaS). Sort 43 places it right after ai_model (42).
--
-- Data-driven: appears in the Bank categorizer dropdown automatically (getCategories
-- reads ledger_categories) and, when assigned, sets pnl_treatment='expense'. It is a
-- plain operating expense (NOT in a CM tier), so on the P&L it lands under "Other
-- Operating". Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

insert into ledger_categories (org_id, slug, label, treatment, flow, sort, is_system) values
  (null, 'ai_tool', 'AI Tool', 'expense', 'out', 43, true)
on conflict do nothing;
