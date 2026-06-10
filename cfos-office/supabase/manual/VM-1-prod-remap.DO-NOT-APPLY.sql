-- ============================================================================
-- VM-1 — Value honesty remap. PRODUCTION COMPANION. DO NOT APPLY.
--
-- Manual application by Lewis only. Never run by automation.
-- Verify the enum column list against prod first (staging discovery 0.7
-- found: transactions.value_category, correction_signals.value_category,
-- value_category_rules.value_category, categories.default_value_category);
-- prod may lack correction_signals.
--
--   SELECT table_name, column_name FROM information_schema.columns
--   WHERE table_schema='public' AND udt_name='value_category_type';
--
-- Apply ONLY after the VM-1 code (gated categoriser + unmapped snapshot
-- bucketing) is deployed to production, otherwise the next ingest re-creates
-- low-confidence leak defaults.
--
-- Record pre-migration baseline first:
--   SELECT value_category, prediction_source, count(*)
--   FROM transactions WHERE deleted_at IS NULL
--   GROUP BY 1,2 ORDER BY 3 DESC;
-- ============================================================================

-- 1. Retire 'no_idea' → 'unsure' on every column using value_category_type.
--    (Enum value is retained — non-destructive — but must never be written
--    again.)
UPDATE transactions SET value_category='unsure' WHERE value_category='no_idea';
UPDATE correction_signals SET value_category='unsure' WHERE value_category='no_idea'; -- skip if table absent in prod
UPDATE value_category_rules SET value_category='unsure' WHERE value_category='no_idea';
-- Staging found travel still defaulting to 'no_idea' (the live writer behind
-- new no_idea rows). Same fix for prod:
UPDATE categories SET default_value_category='unsure' WHERE default_value_category='no_idea';

-- 2. Auto-labelled 'leak' is fiction: unconfirmed category-default leaks
--    become 'unsure' at 0.1.
UPDATE transactions
SET value_category='unsure', value_confidence=0.1
WHERE prediction_source='category_default'
  AND value_category='leak'
  AND COALESCE(value_confirmed_by_user,false)=false;

-- 3. Category defaults are weak priors: cap unconfirmed default confidence
--    at 0.3.
UPDATE transactions
SET value_confidence=LEAST(COALESCE(value_confidence,0), 0.3)
WHERE prediction_source='category_default'
  AND COALESCE(value_confirmed_by_user,false)=false;

-- 4. Recompute monthly_snapshots.spending_by_value_category with the VM-1
--    display gate (mirrors aggregateMonthSpending in
--    src/lib/analytics/monthly-snapshot.ts: income + neutral categories
--    excluded, positive null-category rows skipped, non-displayable labels
--    bucket under 'unmapped'). Snapshots for months with no transactions are
--    left untouched, matching the TS writer's early return.
WITH txn AS (
  SELECT t.user_id,
         date_trunc('month', t.date)::date AS month,
         -t.amount AS delta,
         CASE
           WHEN t.value_category::text IN ('foundation','burden','investment','leak')
                AND (COALESCE(t.value_confirmed_by_user,false)
                     OR COALESCE(t.value_confidence,0) >= 0.6)
           THEN t.value_category::text
           ELSE 'unmapped'
         END AS vc
  FROM transactions t
  WHERE t.category_id IS DISTINCT FROM 'income'
    AND (t.category_id IS NULL OR t.category_id NOT IN ('transfers','debt_repayments','savings_investments'))
    AND NOT (t.amount > 0 AND t.category_id IS NULL)
),
agg AS (
  SELECT user_id, month, jsonb_object_agg(vc, total) AS by_vc
  FROM (SELECT user_id, month, vc, sum(delta) AS total FROM txn GROUP BY 1,2,3) s
  GROUP BY 1,2
)
UPDATE monthly_snapshots ms
SET spending_by_value_category = agg.by_vc
FROM agg
WHERE ms.user_id = agg.user_id AND ms.month = agg.month;

-- 5. Enum collapse in any snapshot JSONB the recompute couldn't reach
--    (orphaned months with no remaining transactions): fold 'no_idea' into
--    'unsure', summing if both keys exist.
UPDATE monthly_snapshots
SET spending_by_value_category =
  (spending_by_value_category - 'no_idea' - 'unsure')
  || jsonb_build_object('unsure',
       COALESCE((spending_by_value_category->>'no_idea')::numeric, 0)
       + COALESCE((spending_by_value_category->>'unsure')::numeric, 0))
WHERE spending_by_value_category ? 'no_idea';

-- ============================================================================
-- Post-apply assertions (all must hold):
--   -- zero no_idea anywhere:
--   SELECT count(*) FROM transactions WHERE value_category='no_idea';            -- 0
--   SELECT count(*) FROM value_category_rules WHERE value_category='no_idea';    -- 0
--   SELECT count(*) FROM categories WHERE default_value_category='no_idea';      -- 0
--   -- zero unconfirmed default leaks:
--   SELECT count(*) FROM transactions
--   WHERE prediction_source='category_default' AND value_category='leak'
--     AND COALESCE(value_confirmed_by_user,false)=false;                         -- 0
--   -- default confidence capped:
--   SELECT max(value_confidence) FROM transactions
--   WHERE prediction_source='category_default'
--     AND COALESCE(value_confirmed_by_user,false)=false;                         -- <= 0.3
-- ============================================================================
