-- Prod backfill for migration 069 — schema drift on monthly_snapshots.
--
-- Apply this BY HAND on production after auditing whether the column already
-- exists. The canonical 001_initial_schema.sql defines it; staging proved the
-- migration history can drift, so audit before assuming prod has it. If a
-- query like:
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='monthly_snapshots'
--     AND column_name='total_fixed_costs';
--
-- returns zero rows on prod, run this file. If it returns one row, this
-- migration is a no-op and can be skipped.

ALTER TABLE public.monthly_snapshots
  ADD COLUMN total_fixed_costs NUMERIC;
