-- Session 32 (A) follow-up — repair value_category_rules unique constraint
--
-- Pre-existing bug (since 2026-04-15 value_category_rules_unique_constraint):
-- the unique index used COALESCE(time_context, '__none__'), which PostgREST
-- cannot reference via .upsert({ onConflict: ... }). All upserts have been
-- silently failing across all users since then. value_category_rules has
-- 0 rows in staging today.
--
-- Fix: make time_context NOT NULL with default '__none__', rebuild the
-- unique index on plain columns. JS code switches onConflict to a column
-- list PostgREST can parse (see lib/prediction/types.ts: VCR_ON_CONFLICT).

-- 1. Backfill any nulls (table is empty in staging; defensive in case of races)
UPDATE public.value_category_rules
SET time_context = '__none__'
WHERE time_context IS NULL;

-- 2. Set default + NOT NULL on time_context
ALTER TABLE public.value_category_rules
  ALTER COLUMN time_context SET DEFAULT '__none__';
ALTER TABLE public.value_category_rules
  ALTER COLUMN time_context SET NOT NULL;

-- 3. Rebuild the unique index without the COALESCE expression
DROP INDEX IF EXISTS public.vcr_unique_match;
CREATE UNIQUE INDEX vcr_unique_match
  ON public.value_category_rules (user_id, match_type, match_value, time_context);

COMMENT ON INDEX public.vcr_unique_match IS
  'Plain-column unique. Replaces the prior COALESCE expression index that PostgREST upsert.onConflict could not reference. See Session 32 follow-up.';
