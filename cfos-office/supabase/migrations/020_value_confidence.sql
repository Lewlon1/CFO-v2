-- Migration: Context-aware value confidence scoring
-- Adds value_confidence and value_confirmed_by_user to transactions,
-- and context_conditions to value_category_rules.

-- 1. New columns on transactions
alter table public.transactions
  add column if not exists value_confidence numeric,
  add column if not exists value_confirmed_by_user boolean not null default false;

comment on column public.transactions.value_confidence is
  'Confidence score (0.0–1.0) for value_category assignment.
   >= 0.8 = auto-assigned (recurring bills, rent).
   0.5–0.8 = suggested but worth reviewing.
   0.2–0.5 = unsure, medium priority review.
   < 0.2 = unsure, high priority review.';

comment on column public.transactions.value_confirmed_by_user is
  'True only when the user has explicitly classified this transaction''s value_category.
   Never set automatically. Never overwritten by propagation.';

-- 2. Partial index for review queue queries
create index if not exists idx_txn_value_review
  on public.transactions (user_id, value_confidence)
  where value_confirmed_by_user = false;

-- 3. Add context_conditions to value_category_rules
alter table public.value_category_rules
  add column if not exists context_conditions jsonb;

comment on column public.value_category_rules.context_conditions is
  'Optional contextual conditions for when this rule applies.
   Null = applies in any context.
   Example: {"hour_range": {"from": 21, "to": 1}, "day_type": "friday_evening"}.
   Supports the principle that the same merchant can have different value categories
   depending on context.';

-- 4. RPC function for merchant history (used by import pipeline)
create or replace function public.merchant_history(p_user_id uuid)
returns table (merchant text, count bigint, median_amount numeric)
language sql stable
as $$
  select
    lower(trim(description)) as merchant,
    count(*)::bigint as count,
    percentile_cont(0.5) within group (order by abs(amount)) as median_amount
  from public.transactions
  where user_id = p_user_id
  group by lower(trim(description))
$$;

-- 5. Backfill existing transactions
-- Transactions the user has already confirmed with a real value category
-- get value_confirmed_by_user = true and full confidence.
update public.transactions
set value_confirmed_by_user = true,
    value_confidence = 1.0
where user_confirmed = true
  and value_category is not null
  and value_category != 'unsure';

-- Everything else gets a baseline confidence of 0.3 (category default level)
update public.transactions
set value_confidence = 0.3
where value_confidence is null;
