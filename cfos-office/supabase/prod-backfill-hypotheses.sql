-- prod-backfill-hypotheses.sql
-- Apply by hand to production. Byte-equivalent to the staging migration
-- 061_user_hypotheses.sql. `if not exists` guards make it safe to re-run.

create table if not exists public.user_hypotheses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thesis_lines jsonb not null,
  confidence numeric(3,2) not null check (confidence >= 0 and confidence <= 1),
  source_signals jsonb not null,
  generated_at timestamptz not null default now(),
  generated_from text not null check (
    generated_from in ('csv_upload', 'value_map_complete', 'periodic_refresh', 'manual')
  ),
  model_used text not null default 'haiku',
  raw_llm_response jsonb,
  superseded_at timestamptz,
  superseded_by uuid references public.user_hypotheses(id) on delete set null
);

create index if not exists user_hypotheses_active_idx
  on public.user_hypotheses (user_id, generated_at desc)
  where superseded_at is null;

create index if not exists user_hypotheses_user_gen_idx
  on public.user_hypotheses (user_id, generated_at desc);

create index if not exists user_hypotheses_superseded_by_idx
  on public.user_hypotheses (superseded_by)
  where superseded_by is not null;

alter table public.user_hypotheses enable row level security;

create policy "users read own hypotheses"
  on public.user_hypotheses for select
  using ((select auth.uid()) = user_id);

create policy "service role writes hypotheses"
  on public.user_hypotheses for insert
  with check ((select auth.uid()) = user_id or (select auth.role()) = 'service_role');

create policy "service role updates hypotheses"
  on public.user_hypotheses for update
  using ((select auth.uid()) = user_id or (select auth.role()) = 'service_role');

comment on table public.user_hypotheses is
  'Per-user thesis layer feeding the first-insight prompt. One active row at a time.';
comment on column public.user_hypotheses.thesis_lines is
  'jsonb array of { text, confidence, status }. status flips via mark_hypothesis_line_contradicted tool.';
comment on column public.user_hypotheses.source_signals is
  'Deterministically-computed signals fed to the LLM. Audit trail only — never surfaced to the user.';
