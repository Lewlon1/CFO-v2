-- 057_dedupe_recurring_expenses_by_lower_name.sql
--
-- recurring_expenses accumulated duplicate rows where the same merchant was
-- written once with UPPERCASE and once with lowercase (different normalisers
-- across detector versions, or detection running before normalisation landed).
-- The (user_id, name) unique constraint is case-sensitive so the duplicates
-- persisted. Same merchants ended up with different frequencies across
-- cases — e.g. "ALKIMIA BARCELONA" tagged 'monthly' and "alkimia barcelona"
-- tagged 'bi-weekly", corrupting bills/budget/nudge consumers.
--
-- Collapse by (user_id, lower(name)). For each cluster keep the row with
-- highest status priority (tracked > detected > dismissed), tiebreak by most
-- recent updated_at. Then canonicalise the survivor's name to lowercase so
-- future case-insensitive lookups match without re-normalising at every read.

BEGIN;

-- Stage 1: identify the canonical survivor for each cluster and delete the rest.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, lower(name)
      ORDER BY
        CASE status
          WHEN 'tracked' THEN 1
          WHEN 'detected' THEN 2
          WHEN 'dismissed' THEN 3
          ELSE 4
        END,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST
    ) AS rn
  FROM public.recurring_expenses
)
DELETE FROM public.recurring_expenses
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Stage 2: lowercase the surviving names. Stage 1 guarantees each
-- (user_id, lower(name)) cluster now has exactly one row, so lowercasing
-- can't violate the existing UNIQUE (user_id, name) constraint.
UPDATE public.recurring_expenses
   SET name = lower(name)
 WHERE name <> lower(name);

COMMIT;
