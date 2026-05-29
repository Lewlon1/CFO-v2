-- Schema-drift fix: monthly_snapshots.total_fixed_costs.
--
-- The column is declared in 001_initial_schema.sql:165 but staging never
-- received it. The application path
-- (lib/analytics/monthly-snapshot.ts → reconcileFixedCosts) computes the
-- value and writes it to this column; without the column the Supabase
-- insert silently drops the field, and getFinancialFacts in compose-first-read.ts
-- (line 209) reads null for every user. The visible symptom is the First
-- Read announcing "fixed costs aren't on file" for every user, regardless
-- of how many recurring or declared bills they have.
--
-- IF NOT EXISTS keeps this migration safe to re-run on any environment that
-- already has the column from the canonical 001 path.

ALTER TABLE public.monthly_snapshots
  ADD COLUMN IF NOT EXISTS total_fixed_costs NUMERIC;
