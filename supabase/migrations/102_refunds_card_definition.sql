-- 102_refunds_card_definition.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Fix the P&L "Refunds" DOUBLE-COUNT.
--
-- _dm_refunds counted a refund via BOTH representations:
--   (a) the separate refund ROW  (type=debit, category='refund'), and
--   (b) the original payment flipped to status='refunded' (type=credit).
-- Gateways that emit BOTH for the same refund — Stripe (charge.refunded flips the
-- charge AND emits a stripe_refund line) and Razorpay (payments API returns the
-- original as 'refunded' AND we load razorpay_refund rows) — were therefore
-- subtracted TWICE in Net Revenue. For Fiesta this inflated the Refunds line to
-- ₹92.66L when the actual refund rows total ₹57.64L.
--
-- FIX: align P&L with the Payments / Raw-Data "Refunds" card — count ONLY the
-- separate refund rows (the explicit refund event). Drop branch (b).
--
-- TRADE-OFF (product decision, accepted): a refund that exists ONLY as a flipped
-- original with no refund row (App Store; part of Razorpay) is no longer netted —
-- exactly as the card already behaves. Those sales stay in Gross, so Net Revenue
-- rises by that flip-only amount. Counting each such refund once would need a
-- cross-row rule (a per-row immutable helper can't see whether a refund row
-- exists); deferred by choice.
--
-- INVARIANT: this redefines a shared rollup helper, so it MUST end by rebuilding
-- every rollup from raw (else the cached Refunds line keeps the old value).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function _dm_refunds(r transactions) returns numeric language sql immutable as $$
  select case
    when _dm_excluded(r) then 0
    when r.conn_include_income
     and r.ledger = 'payments'
     and r.type   = 'debit'
     and r.category = 'refund'
     and r.status = 'completed'
    then _dm_base(r)
    else 0
  end;
$$;

select rebuild_all_rollups();
