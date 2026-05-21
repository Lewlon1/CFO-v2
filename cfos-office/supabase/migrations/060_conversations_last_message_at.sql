-- Adds public.conversations.last_message_at — a denormalised timestamp of
-- the most recent message in each conversation. Maintained by a trigger on
-- public.messages so callers don't have to MAX(messages.created_at) on every
-- read. Used by lib/conversations/open-items.ts to compute
-- days_since_last_session for the resumption context block.
--
-- Apply to staging (qlbhvlssksnrhsleadzn) and prod (iccelmjenljanqrhhzdv).
-- Idempotent via `if not exists` / `create or replace`.

alter table public.conversations
  add column if not exists last_message_at timestamptz;

-- Backfill from existing messages so the column is usable immediately.
update public.conversations c
set last_message_at = sub.last_at
from (
  select conversation_id, max(created_at) as last_at
  from public.messages
  group by conversation_id
) sub
where c.id = sub.conversation_id
  and c.last_message_at is null;

create or replace function public.fn_update_conversation_last_message_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set last_message_at = new.created_at
  where id = new.conversation_id
    and (last_message_at is null or last_message_at < new.created_at);
  return new;
end;
$$;

drop trigger if exists trg_update_conversation_last_message_at on public.messages;
create trigger trg_update_conversation_last_message_at
  after insert on public.messages
  for each row
  execute function public.fn_update_conversation_last_message_at();

create index if not exists conversations_user_last_message_idx
  on public.conversations (user_id, last_message_at desc);

comment on column public.conversations.last_message_at is
  'Timestamp of the most recent message. Maintained by trg_update_conversation_last_message_at on public.messages. Used by open-items / resumption queries.';
