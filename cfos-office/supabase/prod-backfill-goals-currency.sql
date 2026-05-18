-- v2.2 — Goals currency backfill for PROD
--
-- Status: DO NOT auto-apply. Lewis runs this manually on prod after v2.2 ships.
--
-- The migration 054_goals_currency.sql adds the column with EUR default and
-- backfills from user_profiles.primary_currency. The same SQL works on prod;
-- this file is the Lewis-facing record of what to run.

ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EUR';

UPDATE public.goals g
SET currency = COALESCE(up.primary_currency, 'EUR')
FROM public.user_profiles up
WHERE g.user_id = up.id
  AND g.currency = 'EUR'
  AND up.primary_currency IS NOT NULL
  AND up.primary_currency <> 'EUR';

-- Verification:
--   SELECT primary_currency, count(*) FROM goals g
--   JOIN user_profiles up ON up.id = g.user_id
--   GROUP BY primary_currency;
--   -- All counts should match the goals.currency distribution.
