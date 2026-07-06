-- Models feature (M1 walking skeleton) — property decision modeller.
--
-- user_financial_profile: the "baseline-criteria hypothesis" — a small,
-- stable-across-decisions profile tier (5 fields) that seeds future model
-- runs' assumptions without re-asking. Deliberately narrow; promotion/
-- demotion of fields between tiers is validated later via a SQL query over
-- model_runs.assumptions origins, not new instrumentation.
--
-- model_runs: one row per decision-modelling session. `assumptions` is a
-- jsonb map of slot_id -> {value, origin}; `messages` is the interview
-- transcript; `caveats` holds escape-hatch scope warnings.

create table if not exists public.user_financial_profile (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  tax_residency text not null default 'ES',
  base_currency text not null default 'EUR',
  income_band text,
  liquid_savings numeric,
  default_horizon_years int not null default 10,
  updated_at timestamptz not null default now()
);

create table if not exists public.model_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  decision_type text not null,
  schema_version int not null,
  defaults_version text not null,
  status text not null default 'interviewing'
    check (status in ('interviewing','complete')),
  assumptions jsonb not null default '{}',
  messages jsonb not null default '[]',
  caveats jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists model_runs_user_updated_idx
  on public.model_runs (user_id, updated_at desc);

alter table public.user_financial_profile enable row level security;
alter table public.model_runs enable row level security;

-- (select auth.uid()) wrapping per the standing auth_rls_initplan rule.
create policy user_financial_profile_select
  on public.user_financial_profile
  for select
  using ((select auth.uid()) = user_id);

create policy user_financial_profile_insert
  on public.user_financial_profile
  for insert
  with check ((select auth.uid()) = user_id);

create policy user_financial_profile_update
  on public.user_financial_profile
  for update
  using ((select auth.uid()) = user_id);

create policy user_financial_profile_delete
  on public.user_financial_profile
  for delete
  using ((select auth.uid()) = user_id);

create policy model_runs_select
  on public.model_runs
  for select
  using ((select auth.uid()) = user_id);

create policy model_runs_insert
  on public.model_runs
  for insert
  with check ((select auth.uid()) = user_id);

create policy model_runs_update
  on public.model_runs
  for update
  using ((select auth.uid()) = user_id);

create policy model_runs_delete
  on public.model_runs
  for delete
  using ((select auth.uid()) = user_id);

-- updated_at is application-managed (matches the convention in 001 / 067).
