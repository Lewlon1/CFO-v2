-- 044_goal_contributions.sql
-- Session 10 — Goal Progress Engine.
--
-- Adds the contribution ledger that turns goals.current_amount from a
-- write-once snapshot into a derived value (COALESCE(SUM(contributions), 0)).
-- Also adds the login-recompute dedupe column and the small plpgsql helper
-- that performs the atomic SUM-in-UPDATE used by the TS recompute engine.

-- ---------------------------------------------------------------------------
-- 1. goal_contributions table
-- ---------------------------------------------------------------------------

create table if not exists public.goal_contributions (
  id              uuid primary key default gen_random_uuid(),
  goal_id         uuid not null references public.goals(id) on delete cascade,
  user_id         uuid not null references public.user_profiles(id) on delete cascade,
  amount          numeric not null check (amount <> 0),
  note            text,
  kind            text not null default 'manual' check (kind in ('seed', 'manual')),
  logged_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  anonymised_at   timestamptz
);

create index if not exists idx_goal_contributions_goal
  on public.goal_contributions (goal_id, logged_at desc);

-- Prevents a buggy create-goal retry from inserting two seed rows for the
-- same goal. Partial unique index — only active (non-deleted) seed rows.
create unique index if not exists idx_seed_per_goal
  on public.goal_contributions (goal_id)
  where kind = 'seed' and deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. RLS — mirror goals policies
-- ---------------------------------------------------------------------------

alter table public.goal_contributions enable row level security;

drop policy if exists "goal_contributions_select_own" on public.goal_contributions;
create policy "goal_contributions_select_own" on public.goal_contributions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "goal_contributions_insert_own" on public.goal_contributions;
create policy "goal_contributions_insert_own" on public.goal_contributions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "goal_contributions_update_own" on public.goal_contributions;
create policy "goal_contributions_update_own" on public.goal_contributions
  for update to authenticated using (user_id = auth.uid());

drop policy if exists "goal_contributions_delete_own" on public.goal_contributions;
create policy "goal_contributions_delete_own" on public.goal_contributions
  for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Login-recompute dedupe stamp on user_profiles
-- ---------------------------------------------------------------------------

alter table public.user_profiles
  add column if not exists goals_last_synced_at timestamptz;

-- ---------------------------------------------------------------------------
-- 4. Atomic recompute of current_amount with defensive guard.
--    Called by the TS recompute engine. Returns the post-update row so the
--    caller can feed it into computePaceAndOnTrack without a second SELECT.
--    The defensive guard: don't clobber a non-zero current_amount when there
--    are zero contribution rows (protects against a failed seed insert).
-- ---------------------------------------------------------------------------

create or replace function public.recompute_goal_current_amount(p_goal_id uuid)
returns table (
  id uuid,
  current_amount numeric,
  target_amount numeric,
  target_date date,
  status text
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  update public.goals g
  set current_amount = coalesce((
    select sum(c.amount)
    from public.goal_contributions c
    where c.goal_id = g.id
      and c.deleted_at is null
  ), 0)
  where g.id = p_goal_id
    and (
      g.current_amount = 0
      or exists (
        select 1 from public.goal_contributions c
        where c.goal_id = g.id and c.deleted_at is null
      )
    )
  returning g.id, g.current_amount, g.target_amount, g.target_date, g.status;
end;
$$;

comment on function public.recompute_goal_current_amount(uuid) is
  'Atomically sets goals.current_amount = SUM(active contributions). Defensive guard skips goals with zero contributions and non-zero current_amount (protects against failed seed inserts).';

-- ---------------------------------------------------------------------------
-- 5. Backfill — seed rows for existing goals that already have a stored
--    starting amount. Idempotent: NOT EXISTS prevents duplicate inserts on
--    re-runs. Uses goals.created_at as logged_at so the seed sorts before
--    any subsequent contributions.
-- ---------------------------------------------------------------------------

insert into public.goal_contributions (goal_id, user_id, amount, kind, logged_at, created_at)
select g.id, g.user_id, g.current_amount, 'seed', g.created_at, now()
from public.goals g
where g.current_amount > 0
  and g.deleted_at is null
  and not exists (
    select 1
    from public.goal_contributions c
    where c.goal_id = g.id and c.deleted_at is null
  );
