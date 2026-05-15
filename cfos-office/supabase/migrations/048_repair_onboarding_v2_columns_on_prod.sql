-- 048_repair_onboarding_v2_columns_on_prod.sql
--
-- Repair migration. Migrations 040 (entry-struggle) and 041 (Marcus + value-map
-- bridge) add seven columns to public.user_profiles. They were applied to
-- staging in May 2026 but the DDL was never executed against production.
-- Migration 043 then inserted tracker rows for 038-041 onto production under
-- the assumption that prod's schema already matched staging. For 038 and 039
-- that was true; for 040 and 041 it was not. Net effect on prod:
-- supabase_migrations.schema_migrations claims 040 and 041 are applied (so
-- apply_migration / db push will not retry them), but the columns they create
-- do not exist. The /onboarding-v2 server action started 500ing as soon as
-- real users hit the Continue button, because PostgREST rejects the PATCH
-- with "column user_profiles.entry_struggle does not exist".
--
-- This migration re-runs the column DDL with ADD COLUMN IF NOT EXISTS so it
-- is a no-op on staging (where the columns already exist) and effective on
-- production. Column definitions and comments are copied verbatim from 040
-- and 041 so prod ends up byte-identical to staging.
--
-- Apply to prod manually -- Lewis only. Staging no-op.

-- From 040_onboarding_v2_struggle.sql
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS entry_struggle      TEXT,
  ADD COLUMN IF NOT EXISTS entry_struggle_text TEXT,
  ADD COLUMN IF NOT EXISTS entry_struggle_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_route    TEXT;

COMMENT ON COLUMN public.user_profiles.entry_struggle IS
  'Onboarding v2 entry screen response. One of: dont_know, debt, wealth, planning, free_text.';

COMMENT ON COLUMN public.user_profiles.entry_struggle_text IS
  'Free-text answer to entry struggle question. Set only when entry_struggle = ''free_text''.';

COMMENT ON COLUMN public.user_profiles.entry_struggle_at IS
  'When the user submitted the entry struggle question. NULL = not yet answered.';

COMMENT ON COLUMN public.user_profiles.onboarding_route IS
  'Onboarding v2 route taken. One of: value_map (Marcus), chat (James/Sofia/Goal/free-text).';

-- From 041_onboarding_v2_marcus_and_bridge.sql
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS onboarding_step             TEXT,
  ADD COLUMN IF NOT EXISTS value_map_offered_in_chat   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS value_map_declined_in_chat  BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.user_profiles.onboarding_step IS
  'Onboarding v2 journey step. One of: intro_shown, value_map_started, value_map_done, upload_done, archetype_shown, complete. NULL = not started.';

COMMENT ON COLUMN public.user_profiles.value_map_offered_in_chat IS
  'TRUE once the CFO has surfaced the Value Map start_value_map action in chat. One-way ratchet.';

COMMENT ON COLUMN public.user_profiles.value_map_declined_in_chat IS
  'TRUE if the user declined the Value Map offer in chat. One-way ratchet; suppresses further proactive offers.';
