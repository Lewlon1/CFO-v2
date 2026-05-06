-- Session 28: Correction signals pipeline
-- Adds prediction_source + confirmed_at to transactions,
-- rebuilds value_category_rules with new match_type buckets,
-- creates correction_signals table.

-- ── 1. New columns on transactions ──────────────────────────────────────
alter table public.transactions
  add column if not exists prediction_source text default 'category_default',
  add column if not exists confirmed_at timestamptz;

comment on column public.transactions.prediction_source is
  'How the value_category was assigned: user_confirmed, merchant_rule, recurring_essential, category_default, value_map_seed';

comment on column public.transactions.confirmed_at is
  'Timestamp when the user explicitly confirmed/corrected the value_category.';

-- Backfill prediction_source for existing transactions
update public.transactions
set prediction_source = 'user_confirmed',
    confirmed_at = now()
where value_confirmed_by_user = true
  and prediction_source is null or prediction_source = 'category_default';

-- ── 2. Rebuild value_category_rules ─────────────────────────────────────

-- 2a. Preserve existing data
create temp table _vcr_backup as
select
  user_id,
  match_type,
  match_value,
  value_category,
  confidence,
  source,
  context_conditions,
  created_at
from public.value_category_rules;

-- 2b. Drop old table (cascades RLS policies, indexes, constraints)
drop table if exists public.value_category_rules cascade;

-- 2c. Create new table with spec schema
create table public.value_category_rules (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.user_profiles(id) on delete cascade,
  match_type       text not null,
  match_value      text not null,
  value_category   value_category_type not null,
  confidence       numeric(3,2) default 0.50,
  total_signals    integer default 0,
  agreement_ratio  numeric(3,2) default 1.00,
  avg_amount_low   numeric,
  avg_amount_high  numeric,
  time_context     text,
  source           text not null,
  last_signal_at   timestamptz default now(),
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
);

-- Functional unique index (COALESCE can't be inline constraint)
create unique index vcr_unique_match
  on public.value_category_rules(user_id, match_type, match_value, coalesce(time_context, '__none__'));

comment on column public.value_category_rules.match_type is
  'Rule specificity: merchant, merchant_time, merchant_amount, category, category_time, category_amount, global';

comment on column public.value_category_rules.time_context is
  'One of 7 time buckets: weekday_early, weekday_midday, weekday_evening, weekday_late, weekend_morning, weekend_afternoon, weekend_evening. NULL for context-free rules.';

-- 2d. RLS
alter table public.value_category_rules enable row level security;

create policy "vcr_select_own" on public.value_category_rules
  for select to authenticated using (user_id = auth.uid());

create policy "vcr_insert_own" on public.value_category_rules
  for insert to authenticated with check (user_id = auth.uid());

create policy "vcr_update_own" on public.value_category_rules
  for update to authenticated using (user_id = auth.uid());

create policy "vcr_delete_own" on public.value_category_rules
  for delete to authenticated using (user_id = auth.uid());

-- 2e. Indexes
create index idx_vcr_user on public.value_category_rules(user_id);
create index idx_vcr_user_match on public.value_category_rules(user_id, match_type, match_value);

-- 2f. Restore data with match_type mapping
-- merchant_contains (no context) -> merchant
insert into public.value_category_rules (user_id, match_type, match_value, value_category, confidence, source, created_at)
select
  user_id,
  'merchant',
  match_value,
  value_category::value_category_type,
  coalesce(confidence, 0.50),
  case
    when source = 'value_map' then 'value_map'
    when source in ('user_explicit', 'user_classification', 'user_correction_chat') then 'correction'
    else coalesce(source, 'category_default')
  end,
  created_at
from _vcr_backup
where match_type = 'merchant_contains'
  and (context_conditions is null or context_conditions = '{}'::jsonb)
on conflict (user_id, match_type, match_value, coalesce(time_context, '__none__'))
do nothing;

-- category_id -> category
insert into public.value_category_rules (user_id, match_type, match_value, value_category, confidence, source, created_at)
select
  user_id,
  'category',
  match_value,
  value_category::value_category_type,
  coalesce(confidence, 0.50),
  case
    when source = 'value_map' then 'value_map'
    when source in ('user_explicit', 'user_classification', 'user_correction_chat') then 'correction'
    else coalesce(source, 'category_default')
  end,
  created_at
from _vcr_backup
where match_type = 'category_id'
on conflict (user_id, match_type, match_value, coalesce(time_context, '__none__'))
do nothing;

-- merchant_contains WITH context -> merchant_time (best effort: extract time bucket)
-- Context conditions have hour_range and/or day_type — map to closest time_context bucket
insert into public.value_category_rules (user_id, match_type, match_value, value_category, confidence, time_context, source, created_at)
select
  user_id,
  'merchant_time',
  match_value,
  value_category::value_category_type,
  coalesce(confidence, 0.50),
  case
    when context_conditions->>'day_type' = 'friday_evening' then 'weekday_evening'
    when context_conditions->>'day_type' = 'weekend' then 'weekend_afternoon'
    when (context_conditions->'hour_range'->>'from')::int >= 21
      or (context_conditions->'hour_range'->>'from')::int < 5 then 'weekday_late'
    else 'weekday_evening'
  end,
  case
    when source = 'value_map' then 'value_map'
    when source in ('user_explicit', 'user_classification', 'user_correction_chat') then 'correction'
    else coalesce(source, 'category_default')
  end,
  created_at
from _vcr_backup
where match_type = 'merchant_contains'
  and context_conditions is not null
  and context_conditions != '{}'::jsonb
on conflict (user_id, match_type, match_value, coalesce(time_context, '__none__'))
do nothing;

drop table _vcr_backup;

-- ── 3. Create correction_signals table ──────────────────────────────────
create table public.correction_signals (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.user_profiles(id) on delete cascade,
  transaction_id   uuid not null references public.transactions(id) on delete cascade,
  merchant_clean   text not null,
  category_id      text references public.categories(id),
  value_category   value_category_type not null,
  amount           numeric not null,
  transaction_time timestamptz not null,
  time_context     text not null,
  day_of_month     integer not null,
  weight_multiplier numeric(3,2) default 1.00,
  created_at       timestamptz default now()
);

create index idx_correction_signals_user_merchant
  on public.correction_signals(user_id, merchant_clean);

create index idx_correction_signals_user_category
  on public.correction_signals(user_id, category_id);

-- Update the prediction review index to use prediction_source
drop index if exists idx_txn_value_review;
create index idx_txn_prediction_review
  on public.transactions(user_id, value_confidence)
  where prediction_source != 'user_confirmed';

-- RLS
alter table public.correction_signals enable row level security;

create policy "cs_select_own" on public.correction_signals
  for select to authenticated using (user_id = auth.uid());

create policy "cs_insert_own" on public.correction_signals
  for insert to authenticated with check (user_id = auth.uid());
