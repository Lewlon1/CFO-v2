-- PROD BACKFILL — DO NOT auto-apply.
--
-- This file mirrors 067_user_declared_fixed_costs.sql exactly. It is
-- applied by hand to the production Supabase project (iccelmjenljanqrhhzdv)
-- by Lewis before any merge of the value-first-onboarding branch to main.
-- Staging (qlbhvlssksnrhsleadzn) gets the migration via the normal
-- apply_migration path.

CREATE TABLE public.user_declared_fixed_costs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  label                TEXT NOT NULL,
  amount               NUMERIC NOT NULL CHECK (amount >= 0),
  currency             TEXT,
  cadence              TEXT NOT NULL CHECK (cadence IN ('weekly','bi-weekly','monthly','bi-monthly','quarterly','annual')),
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','dismissed','matched')),
  matched_recurring_id UUID REFERENCES public.recurring_expenses(id) ON DELETE SET NULL,
  flagged_benchmark    JSONB,
  source               TEXT NOT NULL DEFAULT 'onboarding_form',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX user_declared_fixed_costs_user_idx
  ON public.user_declared_fixed_costs (user_id);

CREATE INDEX user_declared_fixed_costs_matched_recurring_idx
  ON public.user_declared_fixed_costs (matched_recurring_id)
  WHERE matched_recurring_id IS NOT NULL;

ALTER TABLE public.user_declared_fixed_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_declared_fixed_costs_select
  ON public.user_declared_fixed_costs
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY user_declared_fixed_costs_insert
  ON public.user_declared_fixed_costs
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY user_declared_fixed_costs_update
  ON public.user_declared_fixed_costs
  FOR UPDATE
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY user_declared_fixed_costs_delete
  ON public.user_declared_fixed_costs
  FOR DELETE
  USING ((SELECT auth.uid()) = user_id);
