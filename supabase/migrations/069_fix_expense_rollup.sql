-- 069_fix_expense_rollup.sql
-- 068 reproduced the OLD (039) expense semantics. The live views were rewritten by
-- 041 (net off bank expense reversals) + 044 (posted-status guard). Bring the two
-- expense helpers in line, then rebuild so history matches. Trigger picks up the new
-- definitions automatically (it calls these functions by name).
create or replace function _dm_expense_m(r transactions) returns numeric language sql immutable as $$
  select case
    when _dm_excluded(r) then 0
    when r.status not in ('completed','refunded') then 0
    when r.type='debit' and ((r.ledger='bank' and r.pnl_treatment='expense')
         or (r.ledger='payments' and coalesce(r.category,'') not in ('refund','dispute','settlement'))) then _dm_base(r)
    when r.type='credit' and r.ledger='bank' and r.pnl_treatment='expense' then -_dm_base(r)
    else 0 end; $$;
create or replace function _dm_outflow_l(r transactions) returns numeric language sql immutable as $$
  select case
    when _dm_excluded(r) then 0
    when r.status not in ('completed','refunded') then 0
    when r.type='debit' and ((r.ledger='bank' and r.pnl_treatment='expense')
         or (r.ledger='payments' and coalesce(r.category,'') not in ('dispute','settlement'))) then _dm_base(r)
    when r.type='credit' and r.ledger='bank' and r.pnl_treatment='expense' then -_dm_base(r)
    else 0 end; $$;
select rebuild_dash_rollups();
