-- Value-first onboarding — user-declared fixed costs
--
-- Stores the optional 1-3 recurring bills the user types into the processing
-- form, plus any rent-equivalent declarations that the reconcile step
-- promotes / dismisses against the auto-detected recurring set in
-- `recurring_expenses`. The Phase 3 reconcile helper joins this table with
-- detected recurring to produce the canonical fixed-cost total that lands
-- in `monthly_snapshots.total_fixed_costs`.
--
-- Forward-only: legacy users who never walked the value-first flow have
-- no rows here. The reconciler treats absence as "no declared bills" and
-- falls back to the detected set + monthly_rent from user_profiles.

CREATE TABLE public.user_declared_fixed_costs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  label                TEXT NOT NULL,
  amount               NUMERIC NOT NULL CHECK (amount >= 0),
  currency             TEXT,
  cadence              TEXT NOT NULL CHECK (cadence IN ('weekly','bi-weekly','monthly','bi-monthly','quarterly','annual')),
  -- 'pending' until the reconcile step writes a decision. 'confirmed' means
  -- the bill counts toward total_fixed_costs. 'dismissed' means the user
  -- said "not really a fixed cost, ignore it". 'matched' means the reconcile
  -- step paired this declaration with a detected recurring_expenses row.
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','dismissed','matched')),
  -- Set by the reconcile helper when the declaration's amount + cadence
  -- band-match a detected recurring item. NULL until a match is found.
  matched_recurring_id UUID REFERENCES public.recurring_expenses(id) ON DELETE SET NULL,
  -- Output of flag-against-benchmark.ts. Always NULL until the benchmark
  -- session lights up the integration. The shape is opaque to this table.
  flagged_benchmark    JSONB,
  source               TEXT NOT NULL DEFAULT 'onboarding_form',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX user_declared_fixed_costs_user_idx
  ON public.user_declared_fixed_costs (user_id);

-- Cover the FK so the reconciler's "find the declaration that matched this
-- recurring row" lookup stays cheap.
CREATE INDEX user_declared_fixed_costs_matched_recurring_idx
  ON public.user_declared_fixed_costs (matched_recurring_id)
  WHERE matched_recurring_id IS NOT NULL;

ALTER TABLE public.user_declared_fixed_costs ENABLE ROW LEVEL SECURITY;

-- (select auth.uid()) wrapping per the standing auth_rls_initplan rule.
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

-- updated_at is application-managed (matches the convention in 001).
