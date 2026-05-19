-- v2.2 — Add currency to goals
--
-- WHY: create_goal was inserting rows without a currency, even though
-- ctx.currency (resolved from user_profiles.primary_currency) was available
-- in the tool context. Goals therefore displayed in whatever currency the
-- consumer assumed — usually wrong for non-EUR users.
--
-- WHAT: Adds a NOT NULL currency column with EUR default, then backfills
-- existing rows from each user's primary_currency. After this migration,
-- create_goal persists ctx.currency directly.

ALTER TABLE public.goals
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EUR';

-- Backfill: any existing rows still carrying the EUR default get the user's
-- primary_currency. This is a one-time correction; new inserts will carry
-- whatever ctx.currency resolves to.
UPDATE public.goals g
SET currency = COALESCE(up.primary_currency, 'EUR')
FROM public.user_profiles up
WHERE g.user_id = up.id
  AND g.currency = 'EUR'
  AND up.primary_currency IS NOT NULL
  AND up.primary_currency <> 'EUR';
