create or replace function public.handle_updated_at()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_profiles_updated_at on public.user_profiles;
create trigger user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function public.handle_updated_at();

drop trigger if exists conversations_updated_at on public.conversations;
create trigger conversations_updated_at
  before update on public.conversations
  for each row execute function public.handle_updated_at();

drop trigger if exists financial_portrait_updated_at on public.financial_portrait;
create trigger financial_portrait_updated_at
  before update on public.financial_portrait
  for each row execute function public.handle_updated_at();

-- Auto-create user_profiles row on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.user_profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Add FK from recurring_expenses to categories (safe now that 003 has run)
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'fk_recurring_expenses_category'
  ) then
    alter table public.recurring_expenses
      add constraint fk_recurring_expenses_category
      foreign key (category_id) references public.categories(id)
      on update cascade on delete set null;
  end if;
end $$;
