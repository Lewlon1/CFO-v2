-- 041_onboarding_v2_marcus_and_bridge.sql
--
-- Onboarding v2 (Session B). Adds Marcus-journey step tracking and the
-- Value Map bridge flags used to gate proactive offers in chat.
--
-- Apply to staging (qlbhvlssksnrhsleadzn) via Supabase MCP. Apply to prod
-- manually — Lewis only.

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
