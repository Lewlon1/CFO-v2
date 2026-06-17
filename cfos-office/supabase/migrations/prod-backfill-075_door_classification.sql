-- prod-backfill-075_door_classification.sql
--
-- ⚠️ PROD BACKFILL — DO NOT auto-apply.
--
-- This file mirrors 075_door_classification.sql exactly. It is applied by
-- hand to the production Supabase project (iccelmjenljanqrhhzdv) by Lewis,
-- in the SAME release that ships the estimates-first onboarding (OB) branch
-- to main. Staging (qlbhvlssksnrhsleadzn) gets the migration via the normal
-- apply_migration path.
--
-- Contents: door classification + composite persona columns on
-- user_profiles. door_family and door_confidence are internal only — never
-- shown in any UI. The door raw text reuses the existing
-- entry_struggle_text column (040) — no new column for it.

alter table public.user_profiles
  add column if not exists door_family            text,
  add column if not exists door_confidence        numeric,
  add column if not exists door_reflection        text,
  add column if not exists door_source            text,
  add column if not exists composite_persona_key  text,
  add column if not exists composite_relate       text,
  add column if not exists composite_repick_family text,
  add column if not exists composite_truer_line   text;

alter table public.user_profiles
  add constraint user_profiles_door_family_check
    check (
      door_family is null
      or door_family in ('growth', 'security', 'agency', 'candor')
    );

-- The classifier emits confidence in [0, 1] — sanity range check.
alter table public.user_profiles
  add constraint user_profiles_door_confidence_check
    check (
      door_confidence is null
      or (door_confidence >= 0 and door_confidence <= 1)
    );

alter table public.user_profiles
  add constraint user_profiles_door_source_check
    check (
      door_source is null
      or door_source in ('llm', 'chip')
    );

alter table public.user_profiles
  add constraint user_profiles_composite_relate_check
    check (
      composite_relate is null
      or composite_relate in ('spot_on', 'close', 'not_me')
    );

alter table public.user_profiles
  add constraint user_profiles_composite_repick_family_check
    check (
      composite_repick_family is null
      or composite_repick_family in ('growth', 'security', 'agency', 'candor')
    );

comment on column public.user_profiles.door_family is
  'OB-1: internal door classification family (growth | security | agency | candor). Never shown to users.';

comment on column public.user_profiles.door_confidence is
  'OB-1: raw classifier confidence score in [0, 1] (range-checked). DB only — never rendered in any UI.';

comment on column public.user_profiles.door_reflection is
  'OB-1: the reflection line played back to the user about their door. User-facing copy; user-typed text upstream lives in entry_struggle_text.';

comment on column public.user_profiles.door_source is
  'OB-1: how the door family was assigned. llm = classifier over entry_struggle_text; chip = user tapped a preset chip.';

comment on column public.user_profiles.composite_persona_key is
  'OB-1: key of the composite persona presented at the reveal. Vocabulary lives in the versioned TS config, not the DB.';

comment on column public.user_profiles.composite_relate is
  'OB-1: user reaction to the composite reveal (spot_on | close | not_me).';

comment on column public.user_profiles.composite_repick_family is
  'OB-1: family the user re-picked after a not_me reaction. NULL unless they re-picked.';

comment on column public.user_profiles.composite_truer_line is
  'OB-1: user-typed "what would be truer" free text after the composite reveal.';
