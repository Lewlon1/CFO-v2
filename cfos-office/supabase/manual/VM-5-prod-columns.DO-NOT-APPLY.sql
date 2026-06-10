-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  VM-5 PROD COMPANION — DO NOT APPLY WITHOUT LEWIS'S SIGN-OFF          ║
-- ║  Target: production (iccelmjenljanqrhhzdv) ONLY, applied manually.    ║
-- ╚══════════════════════════════════════════════════════════════════════╝
--
-- Mirrors staging migration 073_vm5_alignment_columns.sql plus the one-time
-- backfill of legacy rows from their stored spending_by_value_category.
-- The backfill arithmetic is the pinned v1 formula
-- (src/lib/value-map/alignment.ts :: alignmentFromValueBuckets):
--
--   per bucket: clamp at 0
--   displayable = foundation + investment + leak + burden
--   eligible    = displayable + every other key (unmapped / legacy unsure /
--                 no_idea), clamped per key
--   aligned_spend_pct     = (foundation+investment)/(foundation+investment+leak)
--                           * 100, 4 dp; NULL when the denominator is 0
--   alignment_confidence  = displayable / eligible, 4 dp; 0 when eligible is 0
--   alignment_version     = 'v1'
--
-- Orphaned snapshots (no user_profiles row) are skipped — same rule as the
-- staging backfill. Forward writes come from the snapshot writer on the next
-- refresh regardless, so this script is only for historical trend depth.

-- 1. Columns (additive, idempotent)
ALTER TABLE monthly_snapshots
  ADD COLUMN IF NOT EXISTS aligned_spend_pct numeric,
  ADD COLUMN IF NOT EXISTS alignment_confidence numeric,
  ADD COLUMN IF NOT EXISTS alignment_version text;

COMMENT ON COLUMN monthly_snapshots.aligned_spend_pct IS
  'VM-5: (foundation+investment)/(foundation+investment+leak) over displayable spend, 0-100. NULL = ratio denominator was 0. Burden excluded from the ratio by design.';
COMMENT ON COLUMN monthly_snapshots.alignment_confidence IS
  'VM-5: displayable spend / eligible spend, 0-1. Score renders only at or above the value-config display floor.';
COMMENT ON COLUMN monthly_snapshots.alignment_version IS
  'VM-5: alignment formula version (v1). NULL = row not yet computed/backfilled.';

-- 2. One-time backfill from stored jsonb (idempotent: only NULL-version rows)
WITH b AS (
  SELECT
    ms.id,
    greatest(coalesce((ms.spending_by_value_category->>'foundation')::numeric, 0), 0) AS f,
    greatest(coalesce((ms.spending_by_value_category->>'investment')::numeric, 0), 0) AS i,
    greatest(coalesce((ms.spending_by_value_category->>'leak')::numeric, 0), 0)       AS l,
    greatest(coalesce((ms.spending_by_value_category->>'burden')::numeric, 0), 0)     AS bu,
    coalesce((
      SELECT sum(greatest(e.value::numeric, 0))
      FROM jsonb_each_text(ms.spending_by_value_category) AS e(key, value)
      WHERE e.key NOT IN ('foundation', 'investment', 'leak', 'burden')
    ), 0) AS nd
  FROM monthly_snapshots ms
  WHERE ms.alignment_version IS NULL
    AND ms.spending_by_value_category IS NOT NULL
    AND EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = ms.user_id)
)
UPDATE monthly_snapshots ms
SET
  aligned_spend_pct = CASE
    WHEN (b.f + b.i + b.l) > 0
    THEN round((b.f + b.i) / (b.f + b.i + b.l) * 100, 4)
    ELSE NULL
  END,
  alignment_confidence = CASE
    WHEN (b.f + b.i + b.l + b.bu + b.nd) > 0
    THEN round((b.f + b.i + b.l + b.bu) / (b.f + b.i + b.l + b.bu + b.nd), 4)
    ELSE 0
  END,
  alignment_version = 'v1'
FROM b
WHERE b.id = ms.id;

-- 3. Verify (expect: orphan rows still NULL-version; everything else 'v1')
-- SELECT alignment_version, count(*) FROM monthly_snapshots GROUP BY 1;
