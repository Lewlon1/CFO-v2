-- 046_backfill_044_registry.sql
--
-- Backfills supabase_migrations.schema_migrations with the row that was
-- never recorded for 044_goal_contributions on CFO Staging.
--
-- Session 10's log notes that 044 was applied to staging via the dashboard /
-- CLI because the connected Supabase MCP in that session pointed at a
-- different project. The schema objects (goal_contributions table,
-- recompute_goal_current_amount function, user_profiles.goals_last_synced_at
-- column) all exist on staging — only the migration tracker is missing.
-- Verified 2026-05-15 via information_schema + pg_proc.
--
-- Safe-on-prod: the INSERT is conditional on the 044 schema actually being
-- present in the current environment. If this file lands on prod before 044
-- does, it is a NOTICE and a no-op — no false-positive registry row gets
-- written. Once Lewis applies 044 to prod and then 046, the row gets added.
--
-- Idempotent. Re-running is safe on either env (existence check +
-- ON CONFLICT DO NOTHING).
--
-- Version 20260514181338 mirrors the local commit time of 044
-- (2e10c95 — Session 10 PR #41) so the registry orders 044 chronologically
-- between 043_backfill_schema_migrations (20260513193835) and
-- 045_action_items_goal_link (20260515082316).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'goal_contributions'
  ) THEN
    INSERT INTO supabase_migrations.schema_migrations (version, name, statements, rollback)
    VALUES ('20260514181338', '044_goal_contributions', ARRAY[]::text[], ARRAY[]::text[])
    ON CONFLICT (version) DO NOTHING;
    RAISE NOTICE '[046] goal_contributions present; ensured 044_goal_contributions registry row';
  ELSE
    RAISE NOTICE '[046] goal_contributions absent; skipping 044 registry backfill (apply 044 first)';
  END IF;
END $$;
