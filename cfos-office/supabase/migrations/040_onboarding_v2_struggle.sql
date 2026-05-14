-- 040_onboarding_v2_struggle.sql
--
-- Onboarding v2 (Session A). Adds entry-screen struggle capture and the
-- routing decision (chat vs value_map) to user_profiles.
--
-- Apply to staging (qlbhvlssksnrhsleadzn) via Supabase CLI / MCP. Apply to
-- prod manually — Lewis only.

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
