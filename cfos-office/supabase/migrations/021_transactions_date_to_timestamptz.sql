-- Promote transactions.date from `date` to `timestamptz` so we can preserve
-- the time-of-day from CSV imports. Time-based contextual value rules
-- (e.g. "Aldi after 6pm = Leak") need hour granularity to match against.
--
-- Existing rows are cast in place; they will retain a 00:00:00 UTC component
-- and remain unaffected by hour-range conditions.

ALTER TABLE public.transactions
  ALTER COLUMN date TYPE timestamptz USING date::timestamptz;
