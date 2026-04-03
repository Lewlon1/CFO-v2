## Database Schema

### Core Tables

```sql
-- Users and profiles (progressive, mostly nullable)
create table user_profiles (
  id uuid primary key references auth.users(id),
  display_name text,
  country text,
  city text,
  primary_currency text default 'EUR',
  age_range text,
  employment_status text,
  gross_salary numeric,
  net_monthly_income numeric,
  pay_frequency text default 'monthly',
  has_bonus_months boolean,
  bonus_month_details jsonb,
  housing_type text,
  monthly_rent numeric,
  relationship_status text,
  partner_employment_status text,
  partner_monthly_contribution numeric,
  dependents integer default 0,
  values_ranking jsonb,
  spending_triggers jsonb,
  risk_tolerance text,
  financial_awareness text,
  advice_style text default 'direct',
  nationality text,
  residency_status text,
  tax_residency_country text,
  years_in_country integer,
  onboarding_completed_at timestamptz,
  profile_completeness integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Financial accounts
create table accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  name text not null,
  type text not null,
  provider text,
  currency text default 'EUR',
  current_balance numeric,
  is_primary_spending boolean default false,
  metadata jsonb,
  created_at timestamptz default now()
);

-- Transactions with dual categorisation
create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  account_id uuid references accounts(id),
  date timestamptz not null,
  description text not null,
  amount numeric not null,
  currency text default 'EUR',
  category_id uuid references categories(id),
  auto_category_confidence numeric,
  user_confirmed boolean default false,
  value_category text,
  is_recurring boolean default false,
  is_shared_expense boolean default false,
  is_holiday_spend boolean default false,
  tags text[],
  notes text,
  source text,
  import_batch_id uuid,
  raw_description text,
  created_at timestamptz default now()
);

-- Traditional spending categories
create table categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  name text not null,
  icon text,
  color text,
  monthly_budget numeric,
  is_fixed boolean default false,
  is_essential boolean default true,
  sort_order integer,
  matching_rules jsonb
);

-- Recurring bills and expenses
create table recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  account_id uuid references accounts(id),
  category_id uuid references categories(id),
  name text not null,
  provider text,
  amount numeric not null,
  currency text default 'EUR',
  frequency text not null,
  billing_day integer,
  current_plan_details jsonb,
  contract_end_date date,
  has_permanencia boolean default false,
  last_optimisation_check timestamptz,
  potential_saving_monthly numeric,
  switch_recommendation text,
  created_at timestamptz default now()
);

-- Financial goals
create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  name text not null,
  description text,
  target_amount numeric,
  current_amount numeric default 0,
  target_date date,
  priority text,
  status text default 'active',
  monthly_required_saving numeric,
  on_track boolean,
  created_at timestamptz default now()
);

-- Investment holdings
create table investment_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  account_id uuid references accounts(id),
  ticker text,
  name text not null,
  asset_type text,
  quantity numeric,
  current_value numeric,
  cost_basis numeric,
  currency text default 'GBP',
  gain_loss_pct numeric,
  allocation_pct numeric,
  last_updated timestamptz default now()
);

-- Chat conversations
create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  title text,
  type text default 'general',
  status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Chat messages
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  role text not null,
  content text not null,
  profile_updates jsonb,
  actions_created jsonb,
  insights_generated jsonb,
  tools_used text[],
  created_at timestamptz default now()
);

-- Action items
create table action_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  conversation_id uuid references conversations(id),
  title text not null,
  description text,
  category text,
  priority text,
  status text default 'pending',
  due_date date,
  last_nudge_at timestamptz,
  nudge_count integer default 0,
  completed_at timestamptz,
  created_at timestamptz default now()
);

-- System-computed monthly snapshots
create table monthly_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  month date not null,
  total_income numeric,
  total_fixed_costs numeric,
  total_discretionary numeric,
  total_spending numeric,
  surplus_deficit numeric,
  spending_by_category jsonb,
  spending_by_value_category jsonb,
  transaction_count integer,
  dining_out_count integer,
  avg_transaction_size numeric,
  largest_transaction numeric,
  largest_transaction_desc text,
  vs_previous_month_pct numeric,
  vs_budget_pct numeric,
  created_at timestamptz default now(),
  unique(user_id, month)
);

-- Financial portrait (behavioral insights)
create table financial_portrait (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  trait_type text not null,
  trait_key text not null,
  trait_value text not null,
  confidence numeric default 0.5,
  evidence text,
  source_conversation_id uuid references conversations(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, trait_key)
);

-- Value Map results
create table value_map_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  session_id text,
  responses jsonb not null,
  archetype_name text,
  archetype_subtitle text,
  full_analysis text,
  certainty_areas jsonb,
  conflict_areas jsonb,
  comfort_patterns jsonb,
  country text,
  completed_at timestamptz default now(),
  created_at timestamptz default now()
);

-- Value category mapping rules
create table value_category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  match_type text not null,
  match_value text not null,
  value_category text not null,
  confidence numeric default 0.5,
  source text,
  created_at timestamptz default now()
);

-- Nudges and notifications
create table nudges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references user_profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  action_url text,
  trigger_rule jsonb,
  status text default 'pending',
  scheduled_for timestamptz,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz default now()
);
```

### Row Level Security

Apply to ALL user-scoped tables:

```sql
alter table [table_name] enable row level security;

create policy "Users can view own data" on [table_name]
  for select using (auth.uid() = user_id);

create policy "Users can insert own data" on [table_name]
  for insert with check (auth.uid() = user_id);

create policy "Users can update own data" on [table_name]
  for update using (auth.uid() = user_id);

create policy "Users can delete own data" on [table_name]
  for delete using (auth.uid() = user_id);
```

For `user_profiles`, use `id` instead of `user_id`:
```sql
create policy "Users can view own profile" on user_profiles
  for select using (auth.uid() = id);
```

### Indexes

```sql
create index idx_transactions_user_date on transactions(user_id, date desc);
create index idx_transactions_user_category on transactions(user_id, category_id);
create index idx_transactions_user_value on transactions(user_id, value_category);
create index idx_messages_conversation on messages(conversation_id, created_at);
create index idx_monthly_snapshots_user on monthly_snapshots(user_id, month desc);
create index idx_action_items_user_status on action_items(user_id, status);
create index idx_nudges_user_status on nudges(user_id, status, scheduled_for);
```

### Triggers

```sql
-- Auto-create profile on user signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into user_profiles (id)
  values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Insert default categories for new users
create or replace function create_default_categories()
returns trigger as $$
begin
  insert into categories (user_id, name, icon, color, is_fixed, is_essential, sort_order, matching_rules)
  values
    (new.id, 'Groceries', '🛒', '#1D9E75', false, true, 1, '["aldi","mercadona","caprabo","carrefour","lidl","condis","primaprix","spar"]'::jsonb),
    (new.id, 'Dining & Bars', '🍽️', '#D85A30', false, false, 2, '["restaurant","bar ","cafe","café","pub","pizza","kebab","burger","sushi","tapas"]'::jsonb),
    (new.id, 'Transport', '🚌', '#534AB7', false, true, 3, '["metro","bus","taxi","bolt","cabify","uber","renfe","train"]'::jsonb),
    (new.id, 'Travel', '✈️', '#E24B4A', false, false, 4, '["ryanair","easyjet","iberia","vueling","booking.com","airbnb","hotel","hostel"]'::jsonb),
    (new.id, 'Entertainment', '🎬', '#D4537E', false, false, 5, '["cinema","cine","netflix","spotify","concert","festival","ticket"]'::jsonb),
    (new.id, 'Shopping', '🛍️', '#BA7517', false, false, 6, '["amazon","zara","apple","el corte","primark","mango"]'::jsonb),
    (new.id, 'Health', '💊', '#378ADD', false, true, 7, '["farmacia","pharmacy","sanitas","doctor","gym","fitness"]'::jsonb),
    (new.id, 'Bills & Utilities', '📄', '#888780', true, true, 8, '["iberdrola","digi","vodafone","movistar","aigues","agua","electric","gas"]'::jsonb),
    (new.id, 'Subscriptions', '🔄', '#639922', true, false, 9, '["spotify","netflix","hbo","disney","revolut","apple music"]'::jsonb),
    (new.id, 'Other', '📦', '#5F5E5A', false, false, 10, null);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_profile_created
  after insert on user_profiles
  for each row execute function create_default_categories();

-- Update profile completeness on profile change
create or replace function update_profile_completeness()
returns trigger as $$
declare
  total_fields integer := 15;
  filled_fields integer := 0;
begin
  if new.display_name is not null then filled_fields := filled_fields + 1; end if;
  if new.country is not null then filled_fields := filled_fields + 1; end if;
  if new.city is not null then filled_fields := filled_fields + 1; end if;
  if new.age_range is not null then filled_fields := filled_fields + 1; end if;
  if new.employment_status is not null then filled_fields := filled_fields + 1; end if;
  if new.net_monthly_income is not null then filled_fields := filled_fields + 1; end if;
  if new.housing_type is not null then filled_fields := filled_fields + 1; end if;
  if new.monthly_rent is not null then filled_fields := filled_fields + 1; end if;
  if new.relationship_status is not null then filled_fields := filled_fields + 1; end if;
  if new.values_ranking is not null then filled_fields := filled_fields + 1; end if;
  if new.spending_triggers is not null then filled_fields := filled_fields + 1; end if;
  if new.risk_tolerance is not null then filled_fields := filled_fields + 1; end if;
  if new.advice_style is not null then filled_fields := filled_fields + 1; end if;
  if new.nationality is not null then filled_fields := filled_fields + 1; end if;
  if new.has_bonus_months is not null then filled_fields := filled_fields + 1; end if;
  
  new.profile_completeness := round((filled_fields::numeric / total_fields) * 100);
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

create trigger before_profile_update
  before update on user_profiles
  for each row execute function update_profile_completeness();
```

---