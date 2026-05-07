-- 039_active_experiments.sql
--
-- Wow Moment v2 (Session 26). Stores the deterministic noticing experiment
-- proposed at the end of onboarding (first_insight beat in OnboardingModal).
-- Foundation for Session 27's Sunday callback engine.
--
-- Lifetime constraint: at most one row per user with status='active'. The
-- candidate engine and save-experiment route also block on the existence of
-- ANY prior row, honouring "one Sonnet call per user, lifetime."
--
-- Apply to staging (qlbhvlssksnrhsleadzn) via Supabase MCP. Apply to prod
-- manually — Lewis only.

create table if not exists public.active_experiments (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.user_profiles(id) on delete cascade,
  conversation_id       uuid references public.conversations(id) on delete set null,
  observation_type      text not null check (observation_type in ('high_freq_merchant', 'category_variance', 'time_pattern')),
  pattern_template_key  text not null,
  pattern_name          text not null,
  observation_payload   jsonb not null,
  question              text not null,
  experiment_text       text not null,
  noticing_target       text not null,
  status                text not null default 'active' check (status in ('active', 'completed', 'dismissed', 'expired')),
  proposed_at           timestamptz not null default now(),
  accepted_at           timestamptz,
  callback_due_at       timestamptz not null,
  cfo_synthesis         text,
  next_action_kind      text,
  next_action_payload   jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- One active experiment per user, ever. The candidate engine also blocks on
-- ANY prior row, but the partial index is the durable database guarantee.
create unique index if not exists active_experiments_one_active_per_user
  on public.active_experiments (user_id)
  where status = 'active';

-- Sunday callback engine (Session 27) reads this index.
create index if not exists idx_active_experiments_callback_due
  on public.active_experiments (callback_due_at)
  where status = 'active';

-- Lifetime-blocking lookup hits this index.
create index if not exists idx_active_experiments_user_id
  on public.active_experiments (user_id);

drop trigger if exists active_experiments_updated_at on public.active_experiments;
create trigger active_experiments_updated_at
  before update on public.active_experiments
  for each row execute function public.handle_updated_at();

alter table public.active_experiments enable row level security;

-- Users read their own.
create policy "active_experiments_select_own"
  on public.active_experiments for select
  to authenticated
  using (user_id = auth.uid());

-- Users update their own (accept/dismiss the experiment from the UI).
create policy "active_experiments_update_own"
  on public.active_experiments for update
  to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- INSERT is system-only. The save-experiment route uses the service client.
create policy "active_experiments_insert_service"
  on public.active_experiments for insert
  to service_role
  with check (true);

comment on table public.active_experiments is
  'Deterministic noticing experiments proposed at first_insight (Wow Moment v2). One active row per user lifetime; Sunday callback engine reads status=active.';
