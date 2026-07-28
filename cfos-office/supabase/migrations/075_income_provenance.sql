-- Income provenance: distinguish observed vs declared income.
--
-- A user can declare a net monthly income in onboarding while their uploaded
-- statements contain no salary deposit (salary paid into another account, or
-- only transfers/repayments land here). Today income detection
-- (lib/analytics/monthly-snapshot.ts → detectIncomeShape) then sets
-- income_shape='unknown' and t3m_income_monthly=0, while the budget/chat layer
-- (loadCurrentBudget) silently uses the DECLARED figure. The two never
-- reconcile: the Read presents the declared number as fact and can call the
-- user "on track" on income it has never actually seen land.
--
-- This column records where the income figure came from so the Read can frame
-- declared income honestly ("the figure you gave me, not one I can see land")
-- and pose the clarifier "is your salary paid into another account?".
--
--   'observed'            — income deposits detected in the statements
--   'declared_unverified' — no income observed, but a declared figure exists
--   'unknown'             — neither observed nor declared
--
-- Nullable + IF NOT EXISTS: additive, safe to re-run, forward-only (existing
-- users sit at NULL until their next ingest recomputes it).

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS income_provenance TEXT;
