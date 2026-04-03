-- ============================================================
-- The CFO's Office — Category System Migration
-- File: 003_category_system.sql
-- Updated: 2026-04-03
--
-- Run in Supabase SQL Editor, or via CLI:
--   supabase db push
--
-- Safe to re-run: all statements use IF NOT EXISTS / ON CONFLICT.
-- ============================================================


-- ============================================================
-- 0. PREAMBLE — clean up old schema if present
--    Drops the old uuid-based categories table and the old
--    uuid category_id column on transactions so this migration
--    can install the correct text-slug version cleanly.
--    Safe to run even if the old schema never existed.
-- ============================================================

alter table public.transactions
  drop column if exists category_id,
  drop column if exists value_category;

drop table if exists public.categories cascade;

drop type if exists public.spend_classification;
drop type if exists public.value_category_type;

create extension if not exists "pgcrypto";


-- ============================================================
-- 1. ENUMS
-- ============================================================

do $$ begin
  create type public.category_tier as enum (
    'core',
    'lifestyle',
    'financial'
  );
exception when duplicate_object then null; end $$;

-- value_category_type is the internal enum name.
-- The column it powers is always called "value_category"
-- throughout the entire codebase — matching product vocabulary
-- (Foundation, Investment, Leak, Burden, Unsure).
do $$ begin
  create type public.value_category_type as enum (
    'foundation',   -- essential, non-negotiable
    'investment',   -- builds future value
    'leak',         -- avoidable / habitual drain
    'burden',       -- unavoidable but unwanted
    'unsure'        -- pending user confirmation
  );
exception when duplicate_object then null; end $$;


-- ============================================================
-- 2. CATEGORIES TABLE  (system-wide, no user_id)
--    Uses text slugs as PKs (e.g. 'housing', 'groceries').
--    Shared across all users — no per-user rows needed.
-- ============================================================

create table if not exists public.categories (
  id                   text                       primary key,  -- slug e.g. 'housing'
  name                 text                       not null,
  tier                 public.category_tier       not null,
  icon                 text                       not null,     -- lucide icon name
  color                text                       not null,     -- design-token key
  description          text,
  examples             text[]                     default '{}',
  default_value_category  public.value_category_type,          -- null = income / not applicable
  is_holiday_eligible  boolean                    not null default false,
  is_active            boolean                    not null default true,
  sort_order           integer                    not null default 0,
  created_at           timestamptz                not null default now()
);

comment on table  public.categories                        is 'Shared spending category definitions for The CFO''s Office.';
comment on column public.categories.id                     is 'Snake_case slug — used as FK on transactions.';
comment on column public.categories.default_value_category is 'AI pre-fill suggestion for value_category; user can override per transaction.';
comment on column public.categories.is_holiday_eligible    is 'Surfaces this category first in the holiday-tagging UI.';


-- ============================================================
-- 3. TRIPS TABLE  (per user — for holiday spend grouping)
-- ============================================================

create table if not exists public.trips (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  name         text        not null,   -- e.g. "Lisbon Apr 2026"
  start_date   date,
  end_date     date,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table  public.trips          is 'User-created trip records that group holiday transactions.';
comment on column public.trips.name     is 'Human-readable label, e.g. "Lisbon Apr 2026". AI-suggested from location/date clusters.';


-- ============================================================
-- 4. TRANSACTION CONTEXT COLUMNS
--    Adds category + value_category to the existing table.
--    The preamble (§0) already dropped any conflicting columns.
-- ============================================================

alter table public.transactions
  add column if not exists category_id             text
    references public.categories(id)
    on update cascade on delete set null,

  -- value_category: the user-facing vocabulary column.
  -- Typed via value_category_type enum for DB-level validation.
  add column if not exists value_category          public.value_category_type,

  -- Holiday context
  add column if not exists is_holiday_spend        boolean   not null default false,
  add column if not exists trip_id                 uuid
    references public.trips(id)
    on delete set null,
  add column if not exists trip_name               text,     -- denormalised for fast display
  add column if not exists holiday_category_override text;   -- Activities | Food | Getting there | Accommodation

comment on column public.transactions.category_id              is 'FK to categories.id (text slug).';
comment on column public.transactions.value_category           is 'User-confirmed or AI-suggested value classification. Overrides the category default_value_category.';
comment on column public.transactions.is_holiday_spend         is 'True when user has tagged this transaction as part of a trip.';
comment on column public.transactions.trip_id                  is 'FK to trips.id — links all spend for a given holiday.';
comment on column public.transactions.trip_name                is 'Denormalised trip label for display without a join.';
comment on column public.transactions.holiday_category_override is 'Optional sub-label within a holiday: Activities, Food, Getting there, Accommodation, etc.';


-- ============================================================
-- 5. SEED: DEFAULT CATEGORIES
--    Uses ON CONFLICT DO UPDATE — safe to re-run at any time.
--    Column renamed: default_classification → default_value_category
-- ============================================================

insert into public.categories
  (id, name, tier, icon, color, description, examples,
   default_value_category, is_holiday_eligible, sort_order)
values

  -- ── Core ──────────────────────────────────────────────────
  (
    'housing', 'Housing', 'core', 'home', 'primary',
    'Rent or mortgage, home insurance, maintenance & repairs',
    array['Rent','Mortgage','Home insurance','Maintenance'],
    'foundation', false, 10
  ),
  (
    'groceries', 'Groceries', 'core', 'shopping-basket', 'success',
    'Supermarkets & food shops — not restaurants or takeaways',
    array['Mercadona','Lidl','Aldi','Carrefour'],
    'foundation', true, 20
  ),
  (
    'transport', 'Transport', 'core', 'train', 'blue',
    'Public transit, fuel, car insurance, taxis & ride-sharing',
    array['Metro','Uber','Fuel','Car insurance'],
    'foundation', true, 30
  ),
  (
    'utilities_bills', 'Utilities & Bills', 'core', 'zap', 'gold',
    'Electricity, water, gas, internet & mobile phone',
    array['Electricity','Gas','Internet','Mobile plan'],
    'foundation', false, 40
  ),
  (
    'eat_drinking_out', 'Eat/Drinking Out', 'core', 'utensils', 'orange',
    'Restaurants, cafés, bars & food delivery apps',
    array['Restaurants','Bars','Glovo','Coffee shops'],
    'leak', true, 50
  ),
  (
    -- color: 'teal' — health is investment-aligned, not an error/danger category
    'health', 'Health', 'core', 'heart-pulse', 'teal',
    'Pharmacy, GP visits, gym membership & supplements',
    array['Pharmacy','Doctor','Gym','Dentist'],
    'investment', false, 60
  ),
  (
    'subscriptions', 'Subscriptions', 'core', 'refresh-cw', 'purple',
    'Streaming, software, cloud storage & recurring digital services',
    array['Netflix','Spotify','Adobe','iCloud'],
    'leak', false, 70
  ),
  (
    'shopping', 'Shopping', 'core', 'shopping-bag', 'warning',
    'Clothing, electronics, household goods & general retail',
    array['Amazon','Zara','El Corte Inglés','IKEA'],
    'leak', true, 80
  ),

  -- ── Lifestyle ─────────────────────────────────────────────
  (
    'travel', 'Travel', 'lifestyle', 'plane', 'blue',
    'Flights, hotels, Airbnb & travel expenses (not daily commute)',
    array['Flights','Hotels','Airbnb','Travel insurance'],
    'unsure', true, 90
  ),
  (
    'entertainment', 'Entertainment & Hobbies', 'lifestyle', 'gamepad-2', 'purple',
    'Gaming, sporting events, concerts & hobby equipment',
    array['Gaming','Ski gear','Concerts','Events'],
    'leak', true, 100
  ),
  (
    -- color: 'pink' — personal care is neutral/foundation, not an error/danger category
    'personal_care', 'Personal Care', 'lifestyle', 'sparkles', 'pink',
    'Haircuts, skincare, beauty products & personal hygiene',
    array['Haircut','Skincare','Barber','Beauty products'],
    'foundation', false, 110
  ),
  (
    'pets', 'Pets', 'lifestyle', 'paw-print', 'orange',
    'Pet food, vet bills, grooming & pet accessories',
    array['Pet food','Vet','Grooming','Accessories'],
    'foundation', false, 120
  ),

  -- ── Financial ─────────────────────────────────────────────
  (
    'savings_investments', 'Savings & Investments', 'financial', 'trending-up', 'success',
    'Transfers to savings, investment accounts & pension contributions',
    array['Savings transfer','Broker','Pension','Crypto'],
    'investment', false, 130
  ),
  (
    -- color: 'warning' — debt is burden-aligned; 'error' reserved for system errors in UI
    'debt_repayments', 'Debt Repayments', 'financial', 'credit-card', 'warning',
    'Loan repayments, credit card payments & outstanding balances',
    array['Loan repayment','Credit card','Student loan'],
    'burden', false, 140
  ),
  (
    'income', 'Income', 'financial', 'wallet', 'primary',
    'Salary, freelance income, dividends & other earnings',
    array['Salary','Freelance','Dividends','Side income'],
    null, false, 150
  )

on conflict (id) do update set
  name                   = excluded.name,
  tier                   = excluded.tier,
  icon                   = excluded.icon,
  color                  = excluded.color,
  description            = excluded.description,
  examples               = excluded.examples,
  default_value_category = excluded.default_value_category,
  is_holiday_eligible    = excluded.is_holiday_eligible,
  sort_order             = excluded.sort_order;


-- ============================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================

-- categories: system-wide read-only for all authenticated users
alter table public.categories enable row level security;

drop policy if exists "categories_read_authenticated" on public.categories;
create policy "categories_read_authenticated"
  on public.categories for select
  to authenticated
  using (is_active = true);

-- trips: users manage only their own rows
alter table public.trips enable row level security;

drop policy if exists "trips_select_own" on public.trips;
create policy "trips_select_own"
  on public.trips for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "trips_insert_own" on public.trips;
create policy "trips_insert_own"
  on public.trips for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "trips_update_own" on public.trips;
create policy "trips_update_own"
  on public.trips for update
  to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "trips_delete_own" on public.trips;
create policy "trips_delete_own"
  on public.trips for delete
  to authenticated
  using (user_id = auth.uid());


-- ============================================================
-- 7. INDEXES
-- ============================================================

create index if not exists idx_categories_tier
  on public.categories(tier);

create index if not exists idx_categories_active
  on public.categories(is_active)
  where is_active = true;

create index if not exists idx_trips_user_id
  on public.trips(user_id);

create index if not exists idx_trips_dates
  on public.trips(user_id, start_date, end_date);

create index if not exists idx_txn_category_id
  on public.transactions(category_id);

create index if not exists idx_txn_value_category
  on public.transactions(value_category);

-- Partial index: only rows that are actually holiday-tagged
create index if not exists idx_txn_holiday_spend
  on public.transactions(trip_id, user_id)
  where is_holiday_spend = true;


-- ============================================================
-- 8. UPDATED_AT TRIGGER FOR TRIPS
-- ============================================================

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trips_updated_at on public.trips;
create trigger trips_updated_at
  before update on public.trips
  for each row execute function public.handle_updated_at();


-- ============================================================
-- ROLLBACK (run manually if needed)
-- ============================================================
--
-- alter table public.transactions
--   drop column if exists category_id,
--   drop column if exists value_category,
--   drop column if exists is_holiday_spend,
--   drop column if exists trip_id,
--   drop column if exists trip_name,
--   drop column if exists holiday_category_override;
--
-- drop table if exists public.trips;
-- drop table if exists public.categories;
-- drop type  if exists public.value_category_type;
-- drop type  if exists public.category_tier;
