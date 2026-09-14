-- 111_pnl_lineitems.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Vendor / gateway LINE ITEMS behind each P&L row (the "Expand" toggle).
--
-- The P&L grid (lib/pnl.ts) shows one row PER CATEGORY (AI Model, Payroll,
-- Payment Gateway Fees…) and per revenue/refund line. Each of those is a SUM of
-- many underlying parties (vendors for expenses, gateways for money-in, payers
-- for bank-collected revenue). The founder wants to expand a row and see those
-- parties, with per-month values, and click a party to see its transactions.
--
-- TIE-OUT (non-negotiable): the party rows under a line MUST sum EXACTLY to that
-- line's total in every month, or the grid loses credibility (we have a history
-- of rollup drift — see 098). We guarantee this the only safe way: this function
-- REUSES the very same immutable row-helpers the category totals are built from
-- (_dm_expense_m, _pnl_fee, _dm_gross, _dm_refunds, _dm_base) and merely adds a
-- PARTY dimension to the GROUP BY. Because the per-row contribution is computed
-- by the identical function, Σ(parties) ≡ line total by construction — it cannot
-- drift as those helpers evolve. The only branches that don't ride a _dm helper
-- (bank customer-payment fold into Gross Revenue, and Other Income) mirror the
-- EXACT predicates lib/pnl.ts uses for them.
--
-- This is NOT a rollup and NOT on the page's critical path: it is called lazily,
-- only when the user turns Expand on, for the currently-viewed window and one
-- org. Each branch pre-filters to a safe SUPERSET of what its helper counts
-- (type='debit' for expenses/refunds, type='credit' for revenue, a fee key for
-- fees) so the scan is bounded and index-friendly, while the helper still decides
-- the actual amount (so tie-out is untouched). A generous local statement_timeout
-- gives headroom without ever masking a real hang.
--
-- Party keys mirror the drill route (app/api/pnl/drill) so clicking a party row
-- opens the existing per-party transaction list unchanged:
--   • money-in lines (revenue / refunds / __pg_fees__) → gateway stem
--     (split_part(source,'_',1), e.g. stripe_refund → 'stripe'); '—' = null/empty
--   • bank-collected revenue → 'bank:<payer name>' (drill route expands these)
--   • expenses / other income → vendor counterparty_name; '—' = null/empty
-- drill_key mirrors PnlRow.drill so the client can match a row to its parties:
--   expense category slug | '__pg_fees__' | 'revenue' | 'refunds' | 'income:<slug>'
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function pnl_lineitems_monthly(p_org uuid, p_from date, p_to date)
returns table(month date, drill_key text, party text, amount numeric, txn_count bigint)
language plpgsql stable as $$
begin
  -- On-demand aggregate over one org × one window; give it room but keep a ceiling.
  set local statement_timeout = '25s';
  return query

  -- ── EXPENSES by vendor (ties to each expense category row) ──────────────────
  select date_trunc('month', t.transaction_date)::date,
         _pnl_expense_cat(t),
         coalesce(nullif(btrim(t.counterparty_name), ''), '—'),
         sum(_dm_expense_m(t)),
         count(*) filter (where _dm_expense_m(t) <> 0)
  from transactions t
  where t.org_id = p_org
    and t.transaction_date >= p_from and t.transaction_date <= p_to
    and t.type = 'debit'                         -- safe superset of _dm_expense_m
  group by 1, 2, 3
  having sum(_dm_expense_m(t)) <> 0

  union all
  -- ── PAYMENT GATEWAY FEES by gateway stem (ties to the __pg_fees__ row) ───────
  select date_trunc('month', t.transaction_date)::date,
         '__pg_fees__',
         coalesce(nullif(split_part(t.source, '_', 1), ''), '—'),
         sum(_pnl_fee(t)),
         count(*) filter (where _pnl_fee(t) <> 0)
  from transactions t
  where t.org_id = p_org
    and t.transaction_date >= p_from and t.transaction_date <= p_to
    and (t.metadata ->> 'fee' is not null or t.metadata ->> 'fees' is not null)
  group by 1, 2, 3
  having sum(_pnl_fee(t)) <> 0

  union all
  -- ── GROSS REVENUE (PG + sales credits) by gateway stem ──────────────────────
  select date_trunc('month', t.transaction_date)::date,
         'revenue',
         coalesce(nullif(split_part(t.source, '_', 1), ''), '—'),
         sum(_dm_gross(t)),
         count(*) filter (where _dm_gross(t) <> 0)
  from transactions t
  where t.org_id = p_org
    and t.transaction_date >= p_from and t.transaction_date <= p_to
    and t.type = 'credit'                        -- safe superset of _dm_gross
  group by 1, 2, 3
  having sum(_dm_gross(t)) <> 0

  union all
  -- ── GROSS REVENUE bank-collected customer payments, by payer ────────────────
  --    (the portion lib/pnl.ts folds into Gross Revenue: ledger='bank',
  --     pnl_treatment='income', category='customer_payment'). Signed credit +,
  --     debit − (a clawback), matching the JS fold exactly.
  select date_trunc('month', t.transaction_date)::date,
         'revenue',
         'bank:' || coalesce(nullif(btrim(t.counterparty_name), ''), '—'),
         sum(case when t.type = 'credit' then _dm_base(t) else -_dm_base(t) end),
         count(*)
  from transactions t
  where t.org_id = p_org
    and t.transaction_date >= p_from and t.transaction_date <= p_to
    and t.ledger = 'bank' and t.pnl_treatment = 'income'
    and t.category = 'customer_payment'
    and t.conn_include_income
    and t.status in ('completed', 'refunded')
  group by 1, 2, 3
  having sum(case when t.type = 'credit' then _dm_base(t) else -_dm_base(t) end) <> 0

  union all
  -- ── REFUNDS by gateway stem (ties to the Refunds row) ───────────────────────
  select date_trunc('month', t.transaction_date)::date,
         'refunds',
         coalesce(nullif(split_part(t.source, '_', 1), ''), '—'),
         sum(_dm_refunds(t)),
         count(*) filter (where _dm_refunds(t) <> 0)
  from transactions t
  where t.org_id = p_org
    and t.transaction_date >= p_from and t.transaction_date <= p_to
    and t.type = 'debit'                         -- safe superset of _dm_refunds (102)
  group by 1, 2, 3
  having sum(_dm_refunds(t)) <> 0

  union all
  -- ── OTHER INCOME (non customer_payment bank income) by payer, per category ───
  --    Mirrors lib/pnl.ts: bank income rows, split by category slug into their
  --    own P&L rows (drill='income:<slug>'), signed credit +, debit −.
  select date_trunc('month', t.transaction_date)::date,
         'income:' || coalesce(nullif(t.category, ''), 'other_income'),
         coalesce(nullif(btrim(t.counterparty_name), ''), '—'),
         sum(case when t.type = 'credit' then _dm_base(t) else -_dm_base(t) end),
         count(*)
  from transactions t
  where t.org_id = p_org
    and t.transaction_date >= p_from and t.transaction_date <= p_to
    and t.ledger = 'bank' and t.pnl_treatment = 'income'
    and t.conn_include_income
    and t.status in ('completed', 'refunded')
    and coalesce(nullif(t.category, ''), 'other_income') <> 'customer_payment'
  group by 1, 2, 3
  having sum(case when t.type = 'credit' then _dm_base(t) else -_dm_base(t) end) <> 0;

end $$;

-- Same grant surface as pnl_monthly (073). The API route (app/api/pnl/lineitems)
-- is the real gate: it checks org membership + the 'pnl' page grant before calling.
grant execute on function pnl_lineitems_monthly(uuid, date, date) to authenticated, anon, service_role;
