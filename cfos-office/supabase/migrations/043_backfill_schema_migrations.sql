-- 043_backfill_schema_migrations.sql
--
-- Backfill supabase_migrations.schema_migrations on production with the four
-- entries that exist on staging but were never recorded on prod. Production's
-- schema already contains every change these migrations apply (verified by
-- spot-checking conversations.analysed_at and the active_experiments table);
-- only the tracker rows are missing.
--
-- Metadata-only: no DDL, no DML against application schemas. Idempotent.
--
-- Versions match the staging tracker exactly:
--   20260503202913  038_conversation_analysed_at
--   20260504144507  039_active_experiments
--   20260507155219  040_onboarding_v2_struggle
--   20260507161353  041_onboarding_v2_marcus_and_bridge
--
-- Staging already has these rows; running this migration there is a no-op.
-- Apply to production manually — Lewis only.

INSERT INTO supabase_migrations.schema_migrations (version, name, statements, rollback)
VALUES
  ('20260503202913', '038_conversation_analysed_at',        ARRAY[]::text[], ARRAY[]::text[]),
  ('20260504144507', '039_active_experiments',              ARRAY[]::text[], ARRAY[]::text[]),
  ('20260507155219', '040_onboarding_v2_struggle',          ARRAY[]::text[], ARRAY[]::text[]),
  ('20260507161353', '041_onboarding_v2_marcus_and_bridge', ARRAY[]::text[], ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;
