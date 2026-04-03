create table if not exists public.value_map_results (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references public.user_profiles(id) on delete cascade,
  session_token      uuid not null default gen_random_uuid(),
  responses          jsonb not null,
  archetype_name     text,
  archetype_subtitle text,
  full_analysis      text,
  certainty_areas    jsonb,
  conflict_areas     jsonb,
  comfort_patterns   jsonb,
  country            text,
  completed_at       timestamptz default now(),
  created_at         timestamptz default now()
);

create table if not exists public.value_category_rules (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.user_profiles(id) on delete cascade,
  match_type     text not null,
  match_value    text not null,
  value_category text not null,
  confidence     numeric default 0.5,
  source         text,
  created_at     timestamptz default now()
);

alter table public.value_map_results enable row level security;

drop policy if exists "value_map_select_own" on public.value_map_results;
create policy "value_map_select_own" on public.value_map_results
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "value_map_insert_anon" on public.value_map_results;
create policy "value_map_insert_anon" on public.value_map_results
  for insert to anon, authenticated with check (true);

alter table public.value_category_rules enable row level security;

drop policy if exists "vcr_select_own" on public.value_category_rules;
create policy "vcr_select_own" on public.value_category_rules
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "vcr_insert_own" on public.value_category_rules;
create policy "vcr_insert_own" on public.value_category_rules
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "vcr_update_own" on public.value_category_rules;
create policy "vcr_update_own" on public.value_category_rules
  for update to authenticated using (user_id = auth.uid());

create index if not exists idx_value_map_session on public.value_map_results(session_token);
create index if not exists idx_value_map_user    on public.value_map_results(user_id);
create index if not exists idx_vcr_user          on public.value_category_rules(user_id);
