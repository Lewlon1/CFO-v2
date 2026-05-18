-- 052_experiment_engine.sql
--
-- Session v2.3 — Experiment Engine.
--
-- Extends public.proposed_experiments in place with the catalog/lifecycle model
-- (template_id, accept/active/outcome states, scoring breakdown). Adds
-- public.goals.type so the scoring engine can map goals to debt_clearance |
-- savings | investment | general.
--
-- Apply to staging (qlbhvlssksnrhsleadzn) via Supabase MCP. Prod runs through
-- supabase/prod-backfill-experiments.sql by hand — Lewis only.

-- ---------------------------------------------------------------------------
-- 1. Map old status values onto the new lifecycle vocabulary.
-- ---------------------------------------------------------------------------
update public.proposed_experiments set status = 'declined'  where status = 'dismissed';
update public.proposed_experiments set status = 'succeeded' where status = 'completed';

alter table public.proposed_experiments
  drop constraint if exists proposed_experiments_status_check;

alter table public.proposed_experiments
  add constraint proposed_experiments_status_check
  check (status in (
    'proposed',  -- generated, surfaced to user, awaiting response
    'accepted',  -- user said yes; experiment is between accepted_at and starts_at (typically = accepted_at)
    'active',    -- starts_at has fired and ends_at is in the future
    'succeeded', -- user self-reported "yes"
    'partial',   -- user self-reported "partial"
    'failed',    -- user self-reported "no"
    'expired',   -- ends_at + 14d elapsed without outcome; NOT counted in completion-rate
    'declined'   -- user said no, or ghost auto-cleaned after 7d
  ));

-- ---------------------------------------------------------------------------
-- 2. New catalog + lifecycle columns. All defaulted/nullable so the existing
--    propose_experiment tool keeps writing rows with no code change.
-- ---------------------------------------------------------------------------
alter table public.proposed_experiments
  add column if not exists template_id          text,
  add column if not exists source_pattern_id    text,
  add column if not exists title                text,
  add column if not exists hypothesis           text,
  add column if not exists success_criterion    text,
  add column if not exists duration_days        int,
  add column if not exists target_metric        jsonb not null default '{}'::jsonb,
  add column if not exists proposal_score       numeric,
  add column if not exists scoring_breakdown    jsonb not null default '{}'::jsonb,
  add column if not exists accepted_at          timestamptz,
  add column if not exists starts_at            timestamptz,
  add column if not exists ends_at              timestamptz,
  add column if not exists outcome_reported_at  timestamptz,
  add column if not exists outcome_self_report  text,
  add column if not exists user_note            text,
  add column if not exists related_goal_id      uuid references public.goals(id) on delete set null,
  add column if not exists deleted_at           timestamptz,
  add column if not exists anonymised_at        timestamptz,
  add column if not exists updated_at           timestamptz not null default now();

alter table public.proposed_experiments
  drop constraint if exists proposed_experiments_outcome_self_report_check;

alter table public.proposed_experiments
  add constraint proposed_experiments_outcome_self_report_check
  check (outcome_self_report is null or outcome_self_report in ('yes', 'partial', 'no'));

-- ---------------------------------------------------------------------------
-- 3. updated_at trigger (canonical handle_updated_at function).
-- ---------------------------------------------------------------------------
drop trigger if exists proposed_experiments_set_updated_at on public.proposed_experiments;
create trigger proposed_experiments_set_updated_at
  before update on public.proposed_experiments
  for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Indexes for the catalog/lifecycle queries.
-- ---------------------------------------------------------------------------
create index if not exists idx_proposed_experiments_active_user
  on public.proposed_experiments (user_id, status)
  where status in ('proposed', 'accepted', 'active') and deleted_at is null;

create index if not exists idx_proposed_experiments_ends_at
  on public.proposed_experiments (ends_at)
  where status = 'active' and deleted_at is null;

create index if not exists idx_proposed_experiments_template_novelty
  on public.proposed_experiments (user_id, template_id, proposed_at desc)
  where template_id is not null and deleted_at is null;

create index if not exists idx_proposed_experiments_ghost
  on public.proposed_experiments (proposed_at)
  where status = 'proposed' and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 5. Refresh the SELECT policy so soft-deleted rows are hidden from users.
-- ---------------------------------------------------------------------------
drop policy if exists "Users can view own experiments" on public.proposed_experiments;
create policy "Users can view own experiments"
  on public.proposed_experiments
  for select using (auth.uid() = user_id and deleted_at is null);

-- Users may update their own rows (accept / decline / report outcome via the
-- tool layer, which runs as the user's supabase client).
drop policy if exists "Users can update own experiments" on public.proposed_experiments;
create policy "Users can update own experiments"
  on public.proposed_experiments
  for update
  using (auth.uid() = user_id and deleted_at is null)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 6. goals.type — added so the scoring engine can map goals to one of four
--    classifications. Backfilled from name + description via keyword heuristic.
-- ---------------------------------------------------------------------------
alter table public.goals
  add column if not exists type text;

update public.goals
   set type = case
     when lower(coalesce(name,'') || ' ' || coalesce(description,'')) ~ '(debt|loan|payoff|credit card|overdraft|mortgage payoff)'
       then 'debt_clearance'
     when lower(coalesce(name,'') || ' ' || coalesce(description,'')) ~ '(invest|pension|retire|isa|stocks|shares|portfolio)'
       then 'investment'
     when lower(coalesce(name,'') || ' ' || coalesce(description,'')) ~ '(save|emergency|deposit|house|fund|buffer|trip|holiday|wedding|car)'
       then 'savings'
     else 'general'
   end
 where type is null;

alter table public.goals
  drop constraint if exists goals_type_check;

alter table public.goals
  add constraint goals_type_check
  check (type in ('debt_clearance', 'savings', 'investment', 'general'));

alter table public.goals
  alter column type set default 'general',
  alter column type set not null;

-- ---------------------------------------------------------------------------
-- 7. Documentation.
-- ---------------------------------------------------------------------------
comment on column public.proposed_experiments.template_id is
  'References a catalog template in src/lib/experiments/templates.ts. Not a FK because templates live in code.';
comment on column public.proposed_experiments.target_metric is
  'Catalog-driven metric shape: { kind, field?, threshold? }. JSONB so per-template variants stay flexible.';
comment on column public.proposed_experiments.scoring_breakdown is
  'Per-dimension scores: { goal_alignment, measurability, effort, reach } in [0,1].';
comment on column public.goals.type is
  'Classification feeding the experiment-engine scoring engine. Backfilled in 052; future writes set explicitly via create_goal tool.';
