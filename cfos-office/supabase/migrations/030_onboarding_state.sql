-- 030: Onboarding progress tracking
-- Adds jsonb column for state machine snapshot + text[] for capability preferences
-- DO NOT RUN IN PRODUCTION — Lewis reviews and applies manually

ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS onboarding_progress jsonb DEFAULT NULL;

ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS capability_preferences text[] DEFAULT NULL;

COMMENT ON COLUMN public.user_profiles.onboarding_progress IS
  'Tracks completion state of the onboarding flow. NULL = never started. Cleared to NULL on completion.';

COMMENT ON COLUMN public.user_profiles.capability_preferences IS
  'User-selected focus areas from onboarding: cashflow, values, networth, scenarios.';
