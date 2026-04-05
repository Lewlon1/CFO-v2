-- Session 11: Nudge System
-- Adds nudge preferences and budget config to user_profiles

alter table public.user_profiles
  add column if not exists nudge_preferences jsonb default '{}'::jsonb,
  add column if not exists savings_rate_target numeric,
  add column if not exists budget_config jsonb default '{}'::jsonb;
