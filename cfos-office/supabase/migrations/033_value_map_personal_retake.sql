-- Session 30: CFO-triggered Value Map personal retake + archetype evolution
--
-- Changes:
-- 1. Add `type` marker to value_map_sessions (onboarding|personal|checkin)
-- 2. Add archetype storage columns to value_map_sessions (previously code tried
--    to write to value_map_results but those columns don't exist there)
-- 3. Add archetype_history jsonb for version chain
-- 4. Add trigger_reason + used_fallback for observability
-- 5. Add retake_timestamp tracking for impact-summary queries

-- ── 1. Session type marker ──────────────────────────────────────────────
alter table public.value_map_sessions
  add column if not exists type text not null default 'onboarding'
    check (type in ('onboarding', 'personal', 'checkin'));

comment on column public.value_map_sessions.type is
  'Session source: onboarding (initial pre-signup VM), personal (CFO-triggered retake with real transactions), checkin (mid-chat micro-classification).';

-- ── 2. Archetype storage on value_map_sessions ──────────────────────────
-- The session is now the source of truth for archetype data. Each personal
-- retake (or monthly-review regen) produces a new session row with a
-- regenerated archetype. session_number doubles as the version number.

alter table public.value_map_sessions
  add column if not exists archetype_name text,
  add column if not exists archetype_subtitle text,
  add column if not exists archetype_traits jsonb,
  add column if not exists archetype_analysis text,
  add column if not exists shift_narrative text,
  add column if not exists archetype_history jsonb default '[]'::jsonb,
  add column if not exists certainty_areas jsonb,
  add column if not exists conflict_areas jsonb,
  add column if not exists trigger_reason text,
  add column if not exists used_fallback boolean default false,
  add column if not exists source_signal_summary jsonb;

comment on column public.value_map_sessions.archetype_history is
  'Array of prior archetype snapshots appended when regenerated. Current archetype stays in archetype_name/subtitle/traits columns.';

comment on column public.value_map_sessions.shift_narrative is
  'Bedrock-generated description of how the user''s archetype evolved since the previous regeneration. NULL for first/original archetype.';

comment on column public.value_map_sessions.trigger_reason is
  'What caused this regeneration: retake_complete, monthly_review, manual.';

-- ── 3. Performance indexes for latest-archetype queries ─────────────────
create index if not exists idx_value_map_sessions_profile_session_desc
  on public.value_map_sessions(profile_id, session_number desc)
  where deleted_at is null;

create index if not exists idx_value_map_sessions_archetype
  on public.value_map_sessions(profile_id, session_number desc)
  where deleted_at is null and archetype_name is not null;

-- ── 4. Ensure transactions.updated_at exists for impact queries ─────────
-- The Phase 3 impact route computes "propagated" counts via updated_at.
-- If the column is missing, add it with a trigger that auto-updates.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transactions'
      and column_name = 'updated_at'
  ) then
    alter table public.transactions
      add column updated_at timestamptz default now();

    create or replace function public._set_updated_at()
    returns trigger as $trigger$
    begin
      new.updated_at = now();
      return new;
    end;
    $trigger$ language plpgsql;

    create trigger transactions_set_updated_at
      before update on public.transactions
      for each row execute function public._set_updated_at();
  end if;
end $$;

-- ── 5. Backfill existing sessions to type='onboarding' ──────────────────
-- The DEFAULT on ADD COLUMN handles new rows; older rows without type are
-- already covered by the default. This is explicit for clarity.
update public.value_map_sessions
set type = 'onboarding'
where type is null;
