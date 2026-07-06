-- Prod backfill for migration 080 — dedupe recurring_expenses case variants.
--
-- DO NOT APPLY AUTOMATICALLY. Lewis runs this by hand on production, after
-- confirming on a read replica (or via a transaction that's rolled back)
-- how many rows the DELETE would remove:
--
--   SELECT user_id, lower(name), count(*)
--   FROM public.recurring_expenses
--   GROUP BY user_id, lower(name)
--   HAVING count(*) > 1;
--
-- Identical to 080's staging migration — same collapse rule as 057, which
-- already ran on prod once for the original case-duplicate class. This
-- catches any duplicates the dashboard/summary route wrote afterward
-- (fixed in the same session, see 080's note).

BEGIN;

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

UPDATE public.recurring_expenses
   SET name = lower(name)
 WHERE name <> lower(name);

COMMIT;
