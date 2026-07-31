-- ============================================================
-- FILE: 045_ai_model_category.sql
-- Break out "AI Model" spend (LLM/inference vendors) from Software & SaaS.
--
-- (1) new category; (2) repoint the existing anthropic/openai rules + add the
-- other AI vendors so FUTURE spend lands in AI Model; (3) reclassify EXISTING
-- bank rows for those vendors that are currently Software or uncategorized — so
-- historical AI spend surfaces immediately (manual categorizations are left
-- untouched). Data-only: dropdown / AI / reports read the taxonomy at runtime.
-- ============================================================

-- 1. Category (expense; sits next to Software & SaaS)
insert into ledger_categories (org_id, slug, label, treatment, flow, sort, is_system) values
  (null, 'ai_model', 'AI Model', 'expense', 'out', 42, true)
on conflict do nothing;

-- 2a. Repoint the two AI vendors that previously mapped to Software.
update category_rules
   set category_slug = 'ai_model'
 where org_id is null
   and match_field = 'counterparty'
   and lower(match_value) in ('anthropic', 'openai')
   and category_slug = 'software';

-- 2b. Add the rest of the common AI/LLM vendors.
insert into category_rules (org_id, match_field, match_type, match_value, category_slug, priority, source) values
  (null, 'counterparty', 'contains', 'openrouter',   'ai_model', 20, 'seed'),
  (null, 'counterparty', 'contains', 'mistral',      'ai_model', 20, 'seed'),
  (null, 'counterparty', 'contains', 'cohere',       'ai_model', 20, 'seed'),
  (null, 'counterparty', 'contains', 'perplexity',   'ai_model', 20, 'seed'),
  (null, 'counterparty', 'contains', 'huggingface',  'ai_model', 20, 'seed'),
  (null, 'counterparty', 'contains', 'hugging face', 'ai_model', 20, 'seed'),
  (null, 'counterparty', 'contains', 'replicate',    'ai_model', 20, 'seed'),
  (null, 'counterparty', 'contains', 'together ai',  'ai_model', 20, 'seed'),
  (null, 'counterparty', 'contains', 'fireworks ai', 'ai_model', 20, 'seed'),
  (null, 'counterparty', 'contains', 'groq',         'ai_model', 20, 'seed'),
  (null, 'counterparty', 'contains', 'elevenlabs',   'ai_model', 20, 'seed'),
  (null, 'counterparty', 'contains', 'deepseek',     'ai_model', 20, 'seed'),
  (null, 'counterparty', 'contains', 'stability ai', 'ai_model', 20, 'seed'),
  (null, 'counterparty', 'contains', 'midjourney',   'ai_model', 20, 'seed')
on conflict do nothing;

-- 3. Reclassify existing bank rows for these vendors (Software or uncategorized
--    only; never overrides a manual categorization). Both debits (spend) and any
--    credits (refunds) → ai_model, so they net within the category.
update transactions
   set category = 'ai_model',
       pnl_treatment = 'expense',
       category_source = 'rule'
 where ledger = 'bank'
   and category_source is distinct from 'manual'
   and coalesce(category, '') in ('software', '')
   and lower(coalesce(counterparty_name, '') || ' ' || coalesce(description, ''))
       ~ '(anthropic|openai|openrouter|mistral|cohere|perplexity|hugging ?face|replicate|together ai|fireworks ai|groq|eleven ?labs|deepseek|stability ai|midjourney)';
