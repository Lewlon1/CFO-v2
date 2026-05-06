-- ============================================================
-- PROD BACKFILL: 037_beta_cohort
-- Run by: Lewis, manually, on iccelmjenljanqrhhzdv
-- Drafted: 2026-05-03
-- DO NOT run via Claude Code or automation
-- ============================================================
--
-- This file pairs with cfos-office/supabase/migrations/037_beta_cohort.sql
-- (already applied to staging qlbhvlssksnrhsleadzn).
--
-- Procedure:
--   1. Open this file in a SQL client connected to PROD.
--   2. Run the BEGIN block + schema change + backfill UPDATEs + verification SELECT.
--   3. Review the verification SELECT output. Expect 8 rows total, 3 with
--      is_lifetime_pro = true (Tijn, Ben, Alex), all 8 with beta_cohort = 'wave_1'.
--   4. If the output matches expectations, run COMMIT (uncomment the line at the bottom).
--   5. If anything is off, run ROLLBACK (uncomment that line instead).
--
-- The transaction is intentionally not auto-committed.
--
-- IMPORTANT: user_profiles.id == auth.users.id. There is NO user_id column
-- on user_profiles. The joins below reflect this.
-- ============================================================

BEGIN;

-- 1. Schema change (mirrors staging migration 037_beta_cohort)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'beta_cohort_t') THEN
    CREATE TYPE beta_cohort_t AS ENUM (
      'wave_1',
      'wave_1_5',
      'wave_2',
      'wave_3',
      'public'
    );
  END IF;
END $$;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS beta_cohort beta_cohort_t,
  ADD COLUMN IF NOT EXISTS is_lifetime_pro boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_user_profiles_beta_cohort
  ON public.user_profiles (beta_cohort)
  WHERE beta_cohort IS NOT NULL;

COMMENT ON COLUMN public.user_profiles.beta_cohort IS
  'Beta wave assignment for analytics segmentation.';
COMMENT ON COLUMN public.user_profiles.is_lifetime_pro IS
  'Tier A beta users granted lifetime Pro access. Bypasses subscription checks.';

-- 2. Backfill: assign all 8 existing prod users to wave_1.
--    Email matching is case-insensitive (ILIKE) and uses handle fragments
--    from the V1 audit. The verification SELECT below catches mismatches.
UPDATE public.user_profiles up
SET beta_cohort = 'wave_1'
FROM auth.users u
WHERE up.id = u.id
  AND u.email ILIKE ANY (ARRAY[
    '%parrillagabriela22%',
    '%duncholding%',
    '%william.t.mccarthy99%',
    '%alexcockwill%',
    '%tijnvs%',
    '%ben.cooke%',
    '%alessandro.corsello2020%',
    '%lonsdale744%'
  ]);

-- 3. Lifetime Pro for Tier A (Tijn, Ben, Alex)
UPDATE public.user_profiles up
SET is_lifetime_pro = true
FROM auth.users u
WHERE up.id = u.id
  AND u.email ILIKE ANY (ARRAY[
    '%tijnvs%',
    '%ben.cooke%',
    '%alexcockwill%'
  ]);

-- 4. Verification — REVIEW BEFORE DECIDING COMMIT vs ROLLBACK
--    Expected: 8 rows total. 3 with is_lifetime_pro = true (Tijn, Ben, Alex).
--    All 8 with beta_cohort = 'wave_1'.
--    If any handle matches an unexpected email, ROLLBACK.
SELECT
  u.email,
  up.beta_cohort,
  up.is_lifetime_pro
FROM public.user_profiles up
JOIN auth.users u ON u.id = up.id
WHERE up.beta_cohort IS NOT NULL OR up.is_lifetime_pro = true
ORDER BY up.is_lifetime_pro DESC, u.email;

-- 5. Decide. Uncomment exactly one of the two lines below:
-- COMMIT;
-- ROLLBACK;
