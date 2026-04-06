-- ============================================================
-- Session 14: Analytics instrumentation tables
-- Raw signal capture — no dashboards, no aggregation
-- ============================================================

-- NOTE: user_events table already exists from data management session
-- with columns: profile_id, event_type, event_category, payload, context,
-- duration_ms, session_id, created_at, deleted_at, anonymised_at

-- Expand event_category check constraint to include analytics categories
ALTER TABLE public.user_events DROP CONSTRAINT IF EXISTS user_events_event_category_check;
ALTER TABLE public.user_events ADD CONSTRAINT user_events_event_category_check
  CHECK (event_category = ANY (ARRAY['explicit', 'behavioural', 'system', 'session', 'correction', 'engagement', 'upload', 'funnel']));

-- 1. Message feedback (thumbs up/down on assistant responses)
create table if not exists public.message_feedback (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.messages(id) on delete cascade,
  user_id      uuid not null references public.user_profiles(id) on delete cascade,
  rating       smallint not null check (rating in (-1, 1)),
  comment      text,
  created_at   timestamptz default now(),
  unique(message_id, user_id)
);

create index if not exists idx_message_feedback_user    on public.message_feedback(user_id, created_at desc);
create index if not exists idx_message_feedback_message on public.message_feedback(message_id);

-- 2. LLM usage log (non-chat Bedrock calls)
create table if not exists public.llm_usage_log (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references public.user_profiles(id) on delete cascade,
  call_type         text not null,
  model             text not null,
  prompt_tokens     integer,
  completion_tokens integer,
  total_tokens      integer,
  duration_ms       integer,
  metadata          jsonb default '{}',
  created_at        timestamptz default now()
);

create index if not exists idx_llm_usage_user on public.llm_usage_log(user_id, created_at desc);
create index if not exists idx_llm_usage_type on public.llm_usage_log(call_type, created_at desc);

-- 3. Add analytics columns to messages table
alter table public.messages add column if not exists user_id uuid references public.user_profiles(id) on delete cascade;
alter table public.messages add column if not exists prompt_tokens integer;
alter table public.messages add column if not exists completion_tokens integer;

-- Backfill user_id on existing messages from conversations
update public.messages m
  set user_id = c.user_id
  from public.conversations c
  where m.conversation_id = c.id
  and m.user_id is null;

create index if not exists idx_messages_user on public.messages(user_id, created_at desc);

-- ============================================================
-- RLS policies
-- ============================================================

-- message_feedback
alter table public.message_feedback enable row level security;

create policy "message_feedback_select_own" on public.message_feedback
  for select to authenticated using (user_id = auth.uid());
create policy "message_feedback_insert_own" on public.message_feedback
  for insert to authenticated with check (user_id = auth.uid());
create policy "message_feedback_update_own" on public.message_feedback
  for update to authenticated using (user_id = auth.uid());
create policy "message_feedback_delete_own" on public.message_feedback
  for delete to authenticated using (user_id = auth.uid());

-- llm_usage_log (read own, inserts via service role)
alter table public.llm_usage_log enable row level security;

create policy "llm_usage_log_select_own" on public.llm_usage_log
  for select to authenticated using (user_id = auth.uid());
create policy "llm_usage_log_insert_own" on public.llm_usage_log
  for insert to authenticated with check (user_id = auth.uid());
