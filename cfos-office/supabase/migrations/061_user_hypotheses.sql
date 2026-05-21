-- 061_user_hypotheses.sql — STAGING ONLY
-- Per-user thesis layer feeding the first-insight prompt. One row per
-- generation event. Most-recent non-superseded row per user is "active".
-- Older rows kept for audit and confidence-trend analysis.

create table if not exists public.user_hypotheses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- The 3-line thesis. Persisted as array so individual lines can be marked
  -- contradicted by the conversation tool.
  -- Shape: [{ text: string, confidence: number, status: 'open'|'contradicted'|'confirmed' }, ...]
  thesis_lines jsonb not null,

  -- Overall confidence at generation time (mean of per-line). Not updated
  -- as line statuses change.
  confidence numeric(3,2) not null check (confidence >= 0 and confidence <= 1),

  -- Deterministically-computed signals fed to the LLM. Internal audit trail
  -- only — NEVER quoted to the user.
  source_signals jsonb not null,

  generated_at timestamptz not null default now(),
  generated_from text not null check (
    generated_from in ('csv_upload', 'value_map_complete', 'periodic_refresh', 'manual')
  ),
  model_used text not null default 'haiku',

  -- Raw LLM response for debugging hallucinations.
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
