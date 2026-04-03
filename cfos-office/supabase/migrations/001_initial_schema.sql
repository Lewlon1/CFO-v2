create table if not exists public.user_profiles (
  id                           uuid primary key references auth.users(id) on delete cascade,
  display_name                 text,
  country                      text,
  city                         text,
  primary_currency             text default 'EUR',
  age_range                    text,
  employment_status            text,
  gross_salary                 numeric,
  net_monthly_income           numeric,
  pay_frequency                text default 'monthly',
  has_bonus_months             boolean,
  bonus_month_details          jsonb,
  housing_type                 text,
  monthly_rent                 numeric,
  relationship_status          text,
  partner_employment_status    text,
  partner_monthly_contribution numeric,
  dependents                   integer default 0,
  values_ranking               jsonb,
  spending_triggers            jsonb,
  risk_tolerance               text,
  financial_awareness          text,
  advice_style                 text default 'direct',
  nationality                  text,
  residency_status             text,
  tax_residency_country        text,
  years_in_country             integer,
  onboarding_completed_at      timestamptz,
  profile_completeness         integer default 0,
  created_at                   timestamptz default now(),
  updated_at                   timestamptz default now()
);

create table if not exists public.accounts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.user_profiles(id) on delete cascade,
  name                text not null,
  type                text not null,
  provider            text,
  currency            text default 'EUR',
  current_balance     numeric,
  is_primary_spending boolean default false,
  metadata            jsonb,
  created_at          timestamptz default now()
);

-- category_id and value_category are added by 003_category_system.sql
create table if not exists public.transactions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.user_profiles(id) on delete cascade,
  account_id               uuid references public.accounts(id) on delete set null,
  date                     timestamptz not null,
  description              text not null,
  raw_description          text,
  amount                   numeric not null,
  currency                 text default 'EUR',
  auto_category_confidence numeric,
  user_confirmed           boolean default false,
  is_recurring             boolean default false,
  is_shared_expense        boolean default false,
  tags                     text[],
  notes                    text,
  source                   text,
  import_batch_id          uuid,
  created_at               timestamptz default now()
);

-- category_id is TEXT — matches categories.id slug (e.g. 'utilities_bills')
-- FK constraint is added in 004_functions.sql after categories table exists
create table if not exists public.recurring_expenses (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.user_profiles(id) on delete cascade,
  account_id               uuid references public.accounts(id) on delete set null,
  category_id              text,
  name                     text not null,
  provider                 text,
  amount                   numeric not null,
  currency                 text default 'EUR',
  frequency                text not null,
  billing_day              integer,
  current_plan_details     jsonb,
  contract_end_date        date,
  has_permanencia          boolean default false,
  last_optimisation_check  timestamptz,
  potential_saving_monthly numeric,
  switch_recommendation    text,
  created_at               timestamptz default now()
);

create table if not exists public.goals (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references public.user_profiles(id) on delete cascade,
  name                    text not null,
  description             text,
  target_amount           numeric,
  current_amount          numeric default 0,
  target_date             date,
  priority                text,
  status                  text default 'active',
  monthly_required_saving numeric,
  on_track                boolean,
  created_at              timestamptz default now()
);

create table if not exists public.investment_holdings (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.user_profiles(id) on delete cascade,
  account_id     uuid references public.accounts(id) on delete set null,
  ticker         text,
  name           text not null,
  asset_type     text,
  quantity       numeric,
  current_value  numeric,
  cost_basis     numeric,
  currency       text default 'EUR',
  gain_loss_pct  numeric,
  allocation_pct numeric,
  last_updated   timestamptz default now()
);

create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.user_profiles(id) on delete cascade,
  title      text,
  type       text default 'general',
  status     text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.messages (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references public.conversations(id) on delete cascade,
  role                text not null,
  content             text not null,
  profile_updates     jsonb,
  actions_created     jsonb,
  insights_generated  jsonb,
  tools_used          text[],
  created_at          timestamptz default now()
);

create table if not exists public.action_items (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.user_profiles(id) on delete cascade,
  conversation_id  uuid references public.conversations(id) on delete set null,
  title            text not null,
  description      text,
  category         text,
  priority         text,
  status           text default 'pending',
  due_date         date,
  last_nudge_at    timestamptz,
  nudge_count      integer default 0,
  completed_at     timestamptz,
  created_at       timestamptz default now()
);

create table if not exists public.monthly_snapshots (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references public.user_profiles(id) on delete cascade,
  month                      date not null,
  total_income               numeric,
  total_fixed_costs          numeric,
  total_discretionary        numeric,
  total_spending             numeric,
  surplus_deficit            numeric,
  spending_by_category       jsonb,
  spending_by_value_category jsonb,
  transaction_count          integer,
  dining_out_count           integer,
  avg_transaction_size       numeric,
  largest_transaction        numeric,
  largest_transaction_desc   text,
  vs_previous_month_pct      numeric,
  vs_budget_pct              numeric,
  created_at                 timestamptz default now(),
  unique(user_id, month)
);

create table if not exists public.financial_portrait (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.user_profiles(id) on delete cascade,
  trait_type             text not null,
  trait_key              text not null,
  trait_value            text not null,
  confidence             numeric default 0.5,
  evidence               text,
  source                 text,
  source_conversation_id uuid references public.conversations(id) on delete set null,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now(),
  unique(user_id, trait_key)
);

create table if not exists public.nudges (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.user_profiles(id) on delete cascade,
  type          text not null,
  title         text not null,
  body          text not null,
  action_url    text,
  trigger_rule  jsonb,
  status        text default 'pending',
  scheduled_for timestamptz,
  sent_at       timestamptz,
  read_at       timestamptz,
  created_at    timestamptz default now()
);

create index if not exists idx_transactions_user_date   on public.transactions(user_id, date desc);
create index if not exists idx_messages_conversation    on public.messages(conversation_id, created_at);
create index if not exists idx_conversations_user       on public.conversations(user_id, updated_at desc);
create index if not exists idx_action_items_user_status on public.action_items(user_id, status);
create index if not exists idx_monthly_snapshots_user   on public.monthly_snapshots(user_id, month desc);
create index if not exists idx_financial_portrait_user  on public.financial_portrait(user_id);
create index if not exists idx_nudges_user_status       on public.nudges(user_id, status, scheduled_for);
