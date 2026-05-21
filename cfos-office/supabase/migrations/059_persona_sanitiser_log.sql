-- Adds public.persona_sanitiser_log — append-only telemetry for the runtime
-- persona-leak sanitiser (lib/ai/persona-sanitiser.ts). The chat route
-- writes a row each time the regex check fires and Haiku rewrites the
-- streamed assistant message before persisting it to public.messages.
--
-- Apply to staging (qlbhvlssksnrhsleadzn) and prod (iccelmjenljanqrhhzdv).
-- Idempotent via `if not exists` / `create or replace`.

create table if not exists public.persona_sanitiser_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null,
  leaks_detected int not null,
  original_text text not null,
  rewritten_text text not null,
  created_at timestamptz not null default now()
);

alter table public.persona_sanitiser_log enable row level security;

drop policy if exists "users read own sanitiser logs" on public.persona_sanitiser_log;
create policy "users read own sanitiser logs"
  on public.persona_sanitiser_log for select
  using ((select auth.uid()) = user_id);

create index if not exists persona_sanitiser_log_user_created_idx
  on public.persona_sanitiser_log (user_id, created_at desc);

comment on table public.persona_sanitiser_log is
  'Append-only log of CFO persona-leak rewrites. One row per rewrite event; never written for clean messages. See lib/ai/persona-sanitiser.ts.';
