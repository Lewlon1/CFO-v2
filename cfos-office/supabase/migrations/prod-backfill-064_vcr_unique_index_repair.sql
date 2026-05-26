-- prod-backfill — Session 32 (A) follow-up — value_category_rules unique repair
-- DO NOT auto-apply. Lewis runs against production (iccelmjenljanqrhhzdv)
-- after a final review during the eventual session-32 merge.
--
-- IMPORTANT for prod: value_category_rules may have non-empty rows on prod
-- where time_context IS NULL. The UPDATE below backfills them to '__none__'.
-- This is safe (preserves prior semantics — NULL meant "no time context").
-- If prod data is materially different from staging, double-check the UPDATE
-- preview before committing.
--
-- Equivalent to staging migration 064_vcr_unique_index_repair.sql.

-- 1. Backfill nulls
UPDATE public.value_category_rules
SET time_context = '__none__'
WHERE time_context IS NULL;

-- 2. Default + NOT NULL
ALTER TABLE public.value_category_rules
  ALTER COLUMN time_context SET DEFAULT '__none__';
ALTER TABLE public.value_category_rules
  ALTER COLUMN time_context SET NOT NULL;

-- 3. Rebuild unique index
DROP INDEX IF EXISTS public.vcr_unique_match;
CREATE UNIQUE INDEX vcr_unique_match
  ON public.value_category_rules (user_id, match_type, match_value, time_context);

COMMENT ON INDEX public.vcr_unique_match IS
  'Plain-column unique. Replaces the prior COALESCE expression index that PostgREST upsert.onConflict could not reference. See Session 32 follow-up.';
