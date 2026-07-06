-- Prod backfill for migration 079 — monthly_snapshots.total_discretionary.
--
-- DO NOT APPLY AUTOMATICALLY. Lewis runs this by hand on production after
-- auditing whether the column already exists:
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='monthly_snapshots'
--     AND column_name='total_discretionary';
--
-- Zero rows → run this file. One row → skip, already present.
--
-- After the column exists, the NEXT ingest / snapshot refresh for each user
-- populates it (syncTotalFixedCosts in lib/analytics/monthly-snapshot.ts).
-- No historical backfill query is included here deliberately — computing it
-- retroactively for prod users requires the same reconciled fixed-cost
-- total the app computes at read time, and running that logic prod-side is
-- exactly the kind of write this file's "additive-only, app writes the
-- values" convention avoids. Existing prod rows sit at NULL (average-
-- discretionary falls back to 'modelled' basis, per financial-position.ts)
-- until the user's next upload/ingest recomputes it.

ALTER TABLE public.monthly_snapshots
  ADD COLUMN total_discretionary NUMERIC;
