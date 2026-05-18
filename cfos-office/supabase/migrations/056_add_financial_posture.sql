-- Migration: add_financial_posture
-- Adds derived posture + runway fields to user_profiles.
-- Adds closing_balance to monthly_snapshots for trajectory analysis.
-- Forward-only deployment — no backfill of historical users.
-- Liquid balance source for v1: accounts.current_balance.
-- See src/lib/analytics/posture.ts and src/lib/analytics/cashflow-aggregates.ts.

alter table public.user_profiles
  add column if not exists financial_posture text,
  add column if not exists posture_confidence numeric,
  add column if not exists runway_days integer,
  add column if not exists t3m_income_monthly numeric,
  add column if not exists t3m_spend_monthly numeric,
  add column if not exists balance_trajectory text,
  add column if not exists posture_detected_at timestamptz;

alter table public.user_profiles
  add constraint user_profiles_financial_posture_check
    check (
      financial_posture is null
      or financial_posture in ('surviving', 'stable', 'planning', 'unknown')
    );

alter table public.user_profiles
  add constraint user_profiles_balance_trajectory_check
    check (
      balance_trajectory is null
      or balance_trajectory in ('growing', 'growing_slowly', 'flat', 'shrinking', 'unknown')
    );

alter table public.monthly_snapshots
  add column if not exists closing_balance numeric;

comment on column public.user_profiles.financial_posture is
  'Derived posture relative to burn rate. Written by updateFinancialPosture(). See src/lib/analytics/posture.ts.';

comment on column public.user_profiles.runway_days is
  'Estimated days of runway at current spend rate against liquid balance. Null when balance is unknown.';

comment on column public.monthly_snapshots.closing_balance is
  'Liquid balance derived by walking back from accounts.current_balance through surplus_deficit. Newest snapshot row reflects balance as of refresh time (not strict month-end). See backfillClosingBalances() in monthly-snapshot.ts.';
