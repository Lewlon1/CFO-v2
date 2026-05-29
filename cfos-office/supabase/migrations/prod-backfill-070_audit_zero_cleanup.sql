-- prod-backfill-070_audit_zero_cleanup.sql
--
-- ⚠️ PRODUCTION-ONLY, MANUAL. Lewis runs this by hand against
-- iccelmjenljanqrhhzdv when ready. It was NOT applied by the Audit Zero
-- session, and there is NO staging companion migration: staging is already
-- clean (active_experiments/dsar_requests dropped both envs; savings_tips /
-- third_party_data_flows never existed on staging; staging test users are
-- handled by scripts/reset-my-staging-data.ts).
--
-- Two independent, idempotent parts. Review the preview SELECTs before
-- committing. Recommended: run inside a transaction and eyeball counts.
--
-- Source of truth: audit/audit-zero.md, audit/audit-zero-killlist.md
-- Approved by Lewis at the Audit Zero Phase-5 gate (2026-05-29).

------------------------------------------------------------------------------
-- PART 1 — Drop the two dead seed tables (prod-only).
--   savings_tips (18 rows) and third_party_data_flows (3 rows): zero code
--   references (`from('…')`), zero inbound FK dependents, superseded pre-V2.
--   047's empty-guard skipped them because they held seed rows; Lewis has
--   approved dropping them WITH that seed data. (Optional: pg_dump them first
--   if you want a keepsake — these are not recoverable after DROP.)
------------------------------------------------------------------------------

-- Preview (run first, expect ~18 and ~3):
--   SELECT 'savings_tips' t, count(*) FROM public.savings_tips
--   UNION ALL SELECT 'third_party_data_flows', count(*) FROM public.third_party_data_flows;

DROP TABLE IF EXISTS public.savings_tips;
DROP TABLE IF EXISTS public.third_party_data_flows;
-- (No CASCADE needed — verified zero inbound FK dependents on both via
--  information_schema.constraint_column_usage, 2026-05-29.)

------------------------------------------------------------------------------
-- PART 2 — Delete the two abandoned @test.com test users + all their data.
--   lewis@test.com (96c1d706-1f08-40bd-83d0-162875b6a793) — goal_chat_started,
--     signed in once at creation (2026-05-15), never returned.
--   gsbs@test.com  (cafda364-cd11-4fe7-b9c8-42bc151c4483) — goal_chat_started,
--     signed in once (2026-05-17), never returned.
--   Both never completed onboarding. The 8 real beta users + 2 completed users
--   are NOT touched.
--
--   Uses the app's own GDPR deletion function delete_user_account() (the same
--   path /api/account/delete uses) — it wipes every public-schema row across
--   the FK graph, including the NO ACTION children (messages, message_feedback,
--   llm_usage_log). The auth.users row is then removed (the app does this via
--   the admin API; the SQL DELETE below is the equivalent and succeeds once
--   delete_user_account has cleared the profile).
------------------------------------------------------------------------------

-- Preview (run first — expect exactly the two @test.com rows, nothing else):
--   SELECT id, email, last_sign_in_at FROM auth.users
--   WHERE email IN ('lewis@test.com','gsbs@test.com');

BEGIN;

-- Wipe all public-schema data for each test user (idempotent — no-op if absent).
SELECT public.delete_user_account(id)
FROM auth.users
WHERE email IN ('lewis@test.com', 'gsbs@test.com');

-- Remove the auth rows (mirrors service.auth.admin.deleteUser()).
DELETE FROM auth.users
WHERE email IN ('lewis@test.com', 'gsbs@test.com');

-- Verify before COMMIT — expect 0 rows:
--   SELECT id, email FROM auth.users WHERE email IN ('lewis@test.com','gsbs@test.com');

COMMIT;

-- After running: re-run get_advisors (security + performance) on prod and
-- confirm no new critical/high warnings vs the Audit Zero baseline.
