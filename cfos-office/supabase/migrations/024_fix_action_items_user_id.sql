-- Resolve legacy schema drift: action_items was on the old `profiles`/`profile_id`
-- schema but all application code (create_action_item, get_action_items,
-- context-builder, nudges, exports, undo) uses `user_id` referencing user_profiles.
-- This migration aligns staging/prod with the code and with 001_initial_schema.sql.
--
-- Steps:
--   1) Remove orphaned rows whose profile_id has no matching user_profile.
--   2) Drop old FK to profiles(id).
--   3) Rename profile_id -> user_id.
--   4) Add new FK to user_profiles(id) ON DELETE CASCADE.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'action_items'
      and column_name = 'profile_id'
  ) then
    delete from public.action_items ai
    where not exists (
      select 1 from public.user_profiles up where up.id = ai.profile_id
    );

    alter table public.action_items
      drop constraint if exists action_items_profile_id_fkey;

    alter table public.action_items
      rename column profile_id to user_id;

    alter table public.action_items
      add constraint action_items_user_id_fkey
      foreign key (user_id) references public.user_profiles(id) on delete cascade;
  end if;
end $$;

create index if not exists idx_action_items_user_status
  on public.action_items(user_id, status);
