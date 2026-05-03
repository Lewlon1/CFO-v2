-- ============================================================
-- PROD BACKFILL: 038 onboarding_completed_at
-- Run by: Lewis, manually, on iccelmjenljanqrhhzdv
-- Drafted: 2026-05-03
-- DO NOT run via Claude Code or automation
-- ============================================================
--
-- Pairs with code change in S-W1.5-09 (markOnboardingCompleteIfReady).
-- No database object changes — application-level helper only. This file
-- backfills onboarding_completed_at for the prod users who already
-- engaged but never reached modal handoff.
--
-- Procedure:
--   1. Open in a SQL client connected to PROD (iccelmjenljanqrhhzdv).
--   2. Run the BEGIN block + UPDATE + verification SELECT.
--   3. Review the verification SELECT. Expect ≤7 rows updated.
--      Each updated row should show a non-NULL onboarding_completed_at and
--      at least one of vm_sessions / txn_count >= 1 / user_msg_count >= 3.
--   4. If output matches expectations, uncomment COMMIT and run.
--   5. If anything is off, uncomment ROLLBACK and run.
--
-- The transaction is intentionally not auto-committed.
--
-- IMPORTANT: user_profiles.id == auth.users.id (no user_id column on
-- user_profiles). value_map_sessions FK is profile_id (not user_id).
-- messages join via conversations.user_id.
-- ============================================================

BEGIN;

-- Backfill the timestamp using the EARLIEST signal observed for each user.
-- COALESCE+'infinity' lets LEAST() ignore signals the user doesn't have;
-- the WHERE clause guarantees at least one is real, so the result is
-- never literally 'infinity'.
UPDATE public.user_profiles up
SET onboarding_completed_at = LEAST(
  COALESCE(
    (SELECT MIN(s.created_at) FROM public.value_map_sessions s
     WHERE s.profile_id = up.id),
    'infinity'::timestamptz
  ),
  COALESCE(
    (SELECT MIN(t.created_at) FROM public.transactions t
     WHERE t.user_id = up.id AND t.deleted_at IS NULL),
    'infinity'::timestamptz
  ),
  COALESCE(
    (SELECT m.created_at FROM public.messages m
     JOIN public.conversations c ON c.id = m.conversation_id
     WHERE c.user_id = up.id AND m.role = 'user' AND m.deleted_at IS NULL
     ORDER BY m.created_at ASC OFFSET 2 LIMIT 1),
    'infinity'::timestamptz
  )
)
WHERE up.anonymised_at IS NULL
  AND up.onboarding_completed_at IS NULL
  AND (
    EXISTS (SELECT 1 FROM public.value_map_sessions s WHERE s.profile_id = up.id)
    OR EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.user_id = up.id AND t.deleted_at IS NULL
    )
    OR (
      SELECT COUNT(*) FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
      WHERE c.user_id = up.id AND m.role = 'user' AND m.deleted_at IS NULL
    ) >= 3
  );

-- Verification — REVIEW BEFORE COMMIT
-- Expected: Ben, Alex, Tijn, Parrillagabriela, William all show a
-- non-NULL onboarding_completed_at. Duncan and Alessandro stay NULL
-- (one preset tap, zero engagement) — they remain in onboarding so
-- we can re-engage them. Lewis (lonsdale744) stamps based on whatever
-- engagement is on prod for that account.
SELECT
  u.email,
  up.onboarding_completed_at,
  up.profile_completeness,
  (SELECT COUNT(*) FROM public.value_map_sessions s
   WHERE s.profile_id = up.id) AS vm_sessions,
  (SELECT COUNT(*) FROM public.transactions t
   WHERE t.user_id = up.id AND t.deleted_at IS NULL) AS txn_count,
  (SELECT COUNT(*) FROM public.messages m
   JOIN public.conversations c ON c.id = m.conversation_id
   WHERE c.user_id = up.id AND m.role = 'user' AND m.deleted_at IS NULL)
   AS user_msg_count
FROM public.user_profiles up
JOIN auth.users u ON u.id = up.id
WHERE u.email ILIKE ANY (ARRAY[
  '%parrillagabriela22%',
  '%duncholding%',
  '%william.t.mccarthy99%',
  '%alexcockwill%',
  '%tijnvs%',
  '%ben.cooke%',
  '%alessandro.corsello2020%',
  '%lonsdale744%'
])
ORDER BY up.onboarding_completed_at NULLS LAST;

-- Decide. Uncomment exactly one of the two lines below:
-- COMMIT;
-- ROLLBACK;
