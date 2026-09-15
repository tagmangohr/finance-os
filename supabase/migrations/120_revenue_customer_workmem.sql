-- 120_revenue_customer_workmem.sql
-- After 119's lean partial index, short ranges are sub-second (30d/90d ~0.7s) but
-- the 12-month default was still ~16-18s. The scaling gave it away: 90d→12mo is
-- ~4x the rows but ~25x the time — a hash aggregate SPILLING TO DISK. Grouping /
-- counting-distinct ~78k customers over 12mo overflows the default 4MB work_mem,
-- forcing multi-pass on-disk aggregation.
--
-- Fix: give ONLY these two functions enough work_mem to keep the aggregate in
-- memory (78k groups need ~10MB; 128MB is comfortable headroom for the group-by,
-- the order-by sort, and the count(distinct) hash). Scoped per-function via
-- ALTER FUNCTION so nothing else on the instance is affected, and they're called
-- from a cached server loader (infrequent), so the memory is a non-issue.

alter function revenue_top_customers(uuid, date, date, int)  set work_mem = '128MB';
alter function revenue_paying_customers(uuid, date, date)     set work_mem = '128MB';
