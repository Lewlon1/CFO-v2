-- 037: Beta cohort + lifetime Pro flag
-- Adds beta_cohort enum and is_lifetime_pro boolean to user_profiles.
-- DO NOT RUN IN PRODUCTION — Lewis reviews and applies manually via prod-backfill.sql

-- Enum guarded for idempotency (CREATE TYPE has no IF NOT EXISTS)
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
  'Beta wave assignment for analytics segmentation. NULL for users not part of any beta cohort.';

COMMENT ON COLUMN public.user_profiles.is_lifetime_pro IS
  'Tier A beta users granted lifetime Pro access. Bypasses subscription checks. Never surfaced to the CFO prompt.';
