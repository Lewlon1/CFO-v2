-- Enable RLS on all user-scoped tables
alter table public.user_profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.goals enable row level security;
alter table public.investment_holdings enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.action_items enable row level security;
alter table public.monthly_snapshots enable row level security;
alter table public.financial_portrait enable row level security;
alter table public.nudges enable row level security;

-- user_profiles (uses id = auth.uid())
drop policy if exists "user_profiles_select_own" on public.user_profiles;
create policy "user_profiles_select_own" on public.user_profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists "user_profiles_insert_own" on public.user_profiles;
create policy "user_profiles_insert_own" on public.user_profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists "user_profiles_update_own" on public.user_profiles;
create policy "user_profiles_update_own" on public.user_profiles
  for update to authenticated using (id = auth.uid());

drop policy if exists "user_profiles_delete_own" on public.user_profiles;
create policy "user_profiles_delete_own" on public.user_profiles
  for delete to authenticated using (id = auth.uid());

-- accounts
drop policy if exists "accounts_select_own" on public.accounts;
create policy "accounts_select_own" on public.accounts
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "accounts_insert_own" on public.accounts;
create policy "accounts_insert_own" on public.accounts
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "accounts_update_own" on public.accounts;
create policy "accounts_update_own" on public.accounts
  for update to authenticated using (user_id = auth.uid());

drop policy if exists "accounts_delete_own" on public.accounts;
create policy "accounts_delete_own" on public.accounts
  for delete to authenticated using (user_id = auth.uid());

-- transactions
drop policy if exists "transactions_select_own" on public.transactions;
create policy "transactions_select_own" on public.transactions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "transactions_insert_own" on public.transactions;
create policy "transactions_insert_own" on public.transactions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "transactions_update_own" on public.transactions;
create policy "transactions_update_own" on public.transactions
  for update to authenticated using (user_id = auth.uid());

drop policy if exists "transactions_delete_own" on public.transactions;
create policy "transactions_delete_own" on public.transactions
  for delete to authenticated using (user_id = auth.uid());

-- recurring_expenses
drop policy if exists "recurring_expenses_select_own" on public.recurring_expenses;
create policy "recurring_expenses_select_own" on public.recurring_expenses
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "recurring_expenses_insert_own" on public.recurring_expenses;
create policy "recurring_expenses_insert_own" on public.recurring_expenses
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "recurring_expenses_update_own" on public.recurring_expenses;
create policy "recurring_expenses_update_own" on public.recurring_expenses
  for update to authenticated using (user_id = auth.uid());

drop policy if exists "recurring_expenses_delete_own" on public.recurring_expenses;
create policy "recurring_expenses_delete_own" on public.recurring_expenses
  for delete to authenticated using (user_id = auth.uid());

-- goals
drop policy if exists "goals_select_own" on public.goals;
create policy "goals_select_own" on public.goals
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "goals_insert_own" on public.goals;
create policy "goals_insert_own" on public.goals
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "goals_update_own" on public.goals;
create policy "goals_update_own" on public.goals
  for update to authenticated using (user_id = auth.uid());

drop policy if exists "goals_delete_own" on public.goals;
create policy "goals_delete_own" on public.goals
  for delete to authenticated using (user_id = auth.uid());

-- investment_holdings
drop policy if exists "investment_holdings_select_own" on public.investment_holdings;
create policy "investment_holdings_select_own" on public.investment_holdings
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "investment_holdings_insert_own" on public.investment_holdings;
create policy "investment_holdings_insert_own" on public.investment_holdings
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "investment_holdings_update_own" on public.investment_holdings;
create policy "investment_holdings_update_own" on public.investment_holdings
  for update to authenticated using (user_id = auth.uid());

drop policy if exists "investment_holdings_delete_own" on public.investment_holdings;
create policy "investment_holdings_delete_own" on public.investment_holdings
  for delete to authenticated using (user_id = auth.uid());

-- conversations
drop policy if exists "conversations_select_own" on public.conversations;
create policy "conversations_select_own" on public.conversations
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "conversations_insert_own" on public.conversations;
create policy "conversations_insert_own" on public.conversations
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "conversations_update_own" on public.conversations;
create policy "conversations_update_own" on public.conversations
  for update to authenticated using (user_id = auth.uid());

drop policy if exists "conversations_delete_own" on public.conversations;
create policy "conversations_delete_own" on public.conversations
  for delete to authenticated using (user_id = auth.uid());

-- messages (via conversation ownership)
drop policy if exists "messages_select_own" on public.messages;
create policy "messages_select_own" on public.messages
  for select to authenticated using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own" on public.messages
  for insert to authenticated with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "messages_delete_own" on public.messages;
create policy "messages_delete_own" on public.messages
  for delete to authenticated using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

-- action_items
drop policy if exists "action_items_select_own" on public.action_items;
create policy "action_items_select_own" on public.action_items
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "action_items_insert_own" on public.action_items;
create policy "action_items_insert_own" on public.action_items
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "action_items_update_own" on public.action_items;
create policy "action_items_update_own" on public.action_items
  for update to authenticated using (user_id = auth.uid());

drop policy if exists "action_items_delete_own" on public.action_items;
create policy "action_items_delete_own" on public.action_items
  for delete to authenticated using (user_id = auth.uid());

-- monthly_snapshots
drop policy if exists "monthly_snapshots_select_own" on public.monthly_snapshots;
create policy "monthly_snapshots_select_own" on public.monthly_snapshots
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "monthly_snapshots_insert_own" on public.monthly_snapshots;
create policy "monthly_snapshots_insert_own" on public.monthly_snapshots
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "monthly_snapshots_update_own" on public.monthly_snapshots;
create policy "monthly_snapshots_update_own" on public.monthly_snapshots
  for update to authenticated using (user_id = auth.uid());

drop policy if exists "monthly_snapshots_delete_own" on public.monthly_snapshots;
create policy "monthly_snapshots_delete_own" on public.monthly_snapshots
  for delete to authenticated using (user_id = auth.uid());

-- financial_portrait
drop policy if exists "financial_portrait_select_own" on public.financial_portrait;
create policy "financial_portrait_select_own" on public.financial_portrait
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "financial_portrait_insert_own" on public.financial_portrait;
create policy "financial_portrait_insert_own" on public.financial_portrait
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "financial_portrait_update_own" on public.financial_portrait;
create policy "financial_portrait_update_own" on public.financial_portrait
  for update to authenticated using (user_id = auth.uid());

drop policy if exists "financial_portrait_delete_own" on public.financial_portrait;
create policy "financial_portrait_delete_own" on public.financial_portrait
  for delete to authenticated using (user_id = auth.uid());

-- nudges
drop policy if exists "nudges_select_own" on public.nudges;
create policy "nudges_select_own" on public.nudges
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "nudges_insert_own" on public.nudges;
create policy "nudges_insert_own" on public.nudges
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "nudges_update_own" on public.nudges;
create policy "nudges_update_own" on public.nudges
  for update to authenticated using (user_id = auth.uid());

drop policy if exists "nudges_delete_own" on public.nudges;
create policy "nudges_delete_own" on public.nudges
  for delete to authenticated using (user_id = auth.uid());
