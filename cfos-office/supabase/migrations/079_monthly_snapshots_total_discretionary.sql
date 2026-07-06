-- Remediation plan (beta-blockers review), Issue 1.2.
--
-- loadAverageDiscretionary (lib/ai/tools/helpers.ts) has always read
-- monthly_snapshots.total_discretionary — a column that was never created.
-- The Supabase 42703 error was never checked, so every call silently
-- returned null, coerced to 0 downstream. Every surplus/accelerate-lever
-- computation in the app therefore assumed users spend nothing beyond
-- their fixed bills — the root cause of the false "funded at plan / spare
-- cash" figures the dorcas/lewis staging review caught.
--
-- Populated by syncTotalFixedCosts (lib/analytics/monthly-snapshot.ts),
-- alongside total_fixed_costs, as GREATEST(0, total_spending − reconciled
-- fixed costs) for each of the user's existing snapshot rows — same
-- current-state-applied-retroactively pattern total_fixed_costs already
-- uses (see 069's migration note).
--
-- IF NOT EXISTS: additive, safe to re-run, forward-only.

ALTER TABLE public.monthly_snapshots
  ADD COLUMN IF NOT EXISTS total_discretionary NUMERIC;
