-- Prod backfill for migration 075 — user_profiles.income_provenance.
--
-- DO NOT APPLY automatically. Lewis runs prod manually.
--
-- Apply BY HAND on production after auditing whether the column already
-- exists:
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='user_profiles'
--     AND column_name='income_provenance';
--
-- If that returns zero rows, run this file. If it returns one row, this
-- migration is a no-op and can be skipped. Additive and nullable — no
-- backfill of existing rows is required; the column populates forward on each
-- user's next ingest.

ALTER TABLE public.user_profiles
  ADD COLUMN income_provenance TEXT;
