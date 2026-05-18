-- Migration: add_income_shape_fields
-- Adds derived income-shape fields to user_profiles.
-- Forward-only deployment — no backfill of existing users.
-- See src/lib/analytics/income-shape.ts for the detector.

alter table public.user_profiles
  add column if not exists income_shape text,
  add column if not exists income_volatility numeric,
  add column if not exists income_shape_deposit_count integer,
  add column if not exists income_shape_detected_at timestamptz;

alter table public.user_profiles
  add constraint user_profiles_income_shape_check
    check (
      income_shape is null
      or income_shape in ('salaried', 'salaried_with_bonus', 'variable', 'unknown')
    );

comment on column public.user_profiles.income_shape is
  'Derived income pattern. Written by updateIncomeShape() during monthly snapshot refresh. See src/lib/analytics/income-shape.ts.';

comment on column public.user_profiles.income_volatility is
  'Coefficient of variation (std dev / mean) across detected income deposits. Null when shape is unknown.';
