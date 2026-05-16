-- Telemetry table for hypothesis-driven experiments proposed by the LLM during
-- first-insight (and steady-state in future sessions). Accept-flow UI is out of
-- scope this session; rows here record proposal metadata only.

create table if not exists public.proposed_experiments (
  id                       uuid        primary key default gen_random_uuid(),
  user_id                  uuid        not null references public.user_profiles(id) on delete cascade,
  conversation_id          uuid,
  message_id               uuid,
  experiment_type          text        not null check (experiment_type in (
                                          'reduce_merchant', 'pause_recurring',
                                          'consolidate_category', 'cap_category',
                                          'redirect_to_goal'
                                       )),
  parameters               jsonb       not null default '{}',
  rationale                text,
  computed_impact          jsonb       not null default '{}',
  affected_transaction_ids uuid[]      default '{}',
  feasibility_note         text,
  status                   text        not null default 'proposed' check (status in (
                                          'proposed', 'accepted', 'dismissed', 'completed'
                                       )),
  proposed_at              timestamptz not null default now(),
  responded_at             timestamptz,
  next_check_in_at         timestamptz,
  created_at               timestamptz not null default now()
);

create index if not exists idx_proposed_experiments_user
  on public.proposed_experiments(user_id, status, created_at desc);

alter table public.proposed_experiments enable row level security;

create policy "Users can view own experiments"
  on public.proposed_experiments
  for select using (auth.uid() = user_id);

create policy "Service role full access"
  on public.proposed_experiments
  for all using (auth.role() = 'service_role');
