-- Session 19: Balance Sheet — Schema
--
-- Adds three tables (assets, liabilities, net_worth_snapshots) that let the CFO
-- see what the user owns and owes, not just what flows through their accounts.
-- Also rewires investment_holdings to sit under assets (non-destructive).
--
-- Scope note: this migration is schema only. Tool factories, context builder
-- integration, and portrait trait writes land in the same session but live in
-- src/lib/ai/... and src/lib/balance-sheet/...

-- =====================================================================
-- assets: balance sheet positions the user owns
-- Separate from accounts (which track transaction containers).
-- =====================================================================
create table if not exists public.assets (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references public.user_profiles(id) on delete cascade,
  account_id      uuid        references public.accounts(id) on delete set null,

  -- Classification. Generic types. Country-specific wrapper names (e.g.
  -- "Stocks & Shares ISA", "plan de pensiones") live in the `name` field.
  -- Country-specific details (tax treatment, contribution limits) live in
  -- `details` jsonb and will be strictly validated in a later session.
  asset_type      text        not null,
  -- Valid values: 'savings', 'stocks', 'bonds', 'pension', 'crypto', 'property', 'other'

  name            text        not null,       -- "Vanguard S&S ISA", "Workplace Pension", "Bitcoin", "Flat in Gràcia"
  provider        text,                       -- "Vanguard", "Nest", "Coinbase", null for property
  currency        text        not null default 'EUR',

  -- Current position
  current_value   numeric,
  cost_basis      numeric,

  -- Type-specific metadata. Loose validation in this migration.
  -- Expected shapes (documentation only):
  --   savings:  { interest_rate, is_fixed, maturity_date, is_easy_access }
  --   stocks:   { platform, account_wrapper, is_tax_sheltered }
  --   bonds:    { platform, bond_type, yield_pct }
  --   pension:  { pension_type, employer_contribution_pct, employee_contribution_pct,
  --              fund_name, retirement_age }
  --   crypto:   { exchange }  (individual coins live in investment_holdings)
  --   property: { purchase_price, purchase_date, is_primary_residence, linked_liability_id }
  details         jsonb       not null default '{}',

  -- Can the user access this money within a few days?
  -- Default true for savings/stocks/bonds/crypto. Default false for pension/property.
  -- Enforced at the application layer (upsert tools); DB default is true for safety.
  is_accessible   boolean     not null default true,

  source          text,       -- 'manual' | 'chat' | 'csv_upload' | 'screenshot'
  last_updated    timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

comment on table  public.assets             is 'User-owned balance sheet positions: savings, investments, pensions, property, crypto.';
comment on column public.assets.asset_type  is 'Generic type. Valid: savings, stocks, bonds, pension, crypto, property, other.';
comment on column public.assets.details     is 'Type-specific jsonb. Loose validation in session 19 — strict per-type schemas land with computation tools.';
comment on column public.assets.account_id  is 'Optional link to an account that also carries transactions (e.g. a savings account with uploaded transactions).';

-- =====================================================================
-- liabilities: debts the user owes
-- =====================================================================
create table if not exists public.liabilities (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references public.user_profiles(id) on delete cascade,

  liability_type        text        not null,
  -- Valid values: 'mortgage', 'student_loan', 'credit_card', 'personal_loan',
  --              'car_finance', 'bnpl', 'overdraft', 'other'

  name                  text        not null,       -- "Barclays Mortgage", "Plan 2 Student Loan", "Amex Gold"
  provider              text,
  currency              text        not null default 'EUR',

  outstanding_balance   numeric     not null,
  original_amount       numeric,

  interest_rate         numeric,                    -- APR as percentage (4.5 means 4.5%)
  rate_type             text,                       -- 'fixed' | 'variable' | 'tracker' | null
  minimum_payment       numeric,
  actual_payment        numeric,
  payment_frequency     text        not null default 'monthly',
  -- Valid: 'monthly', 'weekly', 'fortnightly', 'quarterly', 'annually', 'salary_deducted'

  start_date            date,
  end_date              date,
  remaining_term_months integer,

  -- Type-specific metadata (documentation only):
  --   mortgage:     { property_value, ltv_pct, is_repayment, fixed_until, linked_asset_id }
  --   student_loan: { plan_type, threshold, repayment_pct, is_salary_deducted, country }
  --   credit_card:  { credit_limit, is_zero_pct_period, zero_pct_ends, statement_balance }
  --   bnpl:         { provider, instalments_remaining, instalment_amount }
  details               jsonb       not null default '{}',

  is_priority           boolean     not null default false,   -- user-flagged for aggressive repayment

  source                text,
  last_updated          timestamptz not null default now(),
  created_at            timestamptz not null default now()
);

comment on table  public.liabilities                is 'User debts: mortgages, student loans, credit cards, personal loans, BNPL, overdrafts.';
comment on column public.liabilities.liability_type is 'Valid: mortgage, student_loan, credit_card, personal_loan, car_finance, bnpl, overdraft, other.';
comment on column public.liabilities.interest_rate  is 'APR as a percentage (e.g., 4.5 means 4.5%). Null if unknown.';
comment on column public.liabilities.is_priority    is 'User-flagged for aggressive repayment focus.';

-- =====================================================================
-- net_worth_snapshots: monthly balance sheet snapshots
-- Parallels monthly_snapshots (cash flow). Populated in a later session.
-- =====================================================================
create table if not exists public.net_worth_snapshots (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references public.user_profiles(id) on delete cascade,
  month                 date        not null,

  total_assets          numeric,
  total_liabilities     numeric,
  net_worth             numeric,

  assets_by_type        jsonb,
  liabilities_by_type   jsonb,

  accessible_assets     numeric,
  locked_assets         numeric,

  net_worth_change      numeric,
  net_worth_change_pct  numeric,

  created_at            timestamptz not null default now(),
  unique(user_id, month)
);

comment on table public.net_worth_snapshots is 'Monthly balance sheet snapshots. Computed alongside monthly_snapshots — populated in a later session.';

-- =====================================================================
-- Rewire investment_holdings to sit under assets.
-- account_id is kept as a legacy column (zero current code references).
-- Backfill of existing holdings happens in a later session.
-- =====================================================================
alter table public.investment_holdings
  add column if not exists asset_id uuid references public.assets(id) on delete cascade;

comment on column public.investment_holdings.asset_id is 'Parent asset (type: stocks, bonds, or crypto). Each holding is a position within an asset. account_id remains as legacy column.';

-- =====================================================================
-- Indexes
-- =====================================================================
create index if not exists idx_assets_user             on public.assets(user_id);
create index if not exists idx_assets_user_type        on public.assets(user_id, asset_type);
create index if not exists idx_liabilities_user        on public.liabilities(user_id);
create index if not exists idx_liabilities_user_type   on public.liabilities(user_id, liability_type);
create index if not exists idx_net_worth_user_month    on public.net_worth_snapshots(user_id, month desc);
create index if not exists idx_holdings_asset          on public.investment_holdings(asset_id);

-- =====================================================================
-- RLS policies — user owns own data
-- =====================================================================
alter table public.assets enable row level security;

drop policy if exists "assets_select_own" on public.assets;
create policy "assets_select_own" on public.assets
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "assets_insert_own" on public.assets;
create policy "assets_insert_own" on public.assets
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "assets_update_own" on public.assets;
create policy "assets_update_own" on public.assets
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "assets_delete_own" on public.assets;
create policy "assets_delete_own" on public.assets
  for delete to authenticated using (user_id = auth.uid());

alter table public.liabilities enable row level security;

drop policy if exists "liabilities_select_own" on public.liabilities;
create policy "liabilities_select_own" on public.liabilities
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "liabilities_insert_own" on public.liabilities;
create policy "liabilities_insert_own" on public.liabilities
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "liabilities_update_own" on public.liabilities;
create policy "liabilities_update_own" on public.liabilities
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "liabilities_delete_own" on public.liabilities;
create policy "liabilities_delete_own" on public.liabilities
  for delete to authenticated using (user_id = auth.uid());

alter table public.net_worth_snapshots enable row level security;

drop policy if exists "net_worth_snapshots_select_own" on public.net_worth_snapshots;
create policy "net_worth_snapshots_select_own" on public.net_worth_snapshots
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "net_worth_snapshots_insert_own" on public.net_worth_snapshots;
create policy "net_worth_snapshots_insert_own" on public.net_worth_snapshots
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "net_worth_snapshots_update_own" on public.net_worth_snapshots;
create policy "net_worth_snapshots_update_own" on public.net_worth_snapshots
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "net_worth_snapshots_delete_own" on public.net_worth_snapshots;
create policy "net_worth_snapshots_delete_own" on public.net_worth_snapshots
  for delete to authenticated using (user_id = auth.uid());
