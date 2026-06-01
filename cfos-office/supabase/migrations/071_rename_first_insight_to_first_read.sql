-- 071 — Rename the first-Read measurement surface from the retired
-- "first_insight" vocabulary to "first_read", matching the live composition
-- pipeline (compose-first-read, first_read_delivered, first_read_metadata).
--
-- Scope = concept #1 only (the conversation type + the wow message-id column +
-- the two validation analytics events). It deliberately does NOT touch the
-- distinct "computed insight payload" concept (computeFirstInsight /
-- FirstInsightPayload / conversations.metadata.first_insight_payload), which
-- keeps its name in code and therefore on disk.
--
-- ORDERING: apply this to STAGING (qlbhvlssksnrhsleadzn) BEFORE deploying the
-- v2.7 branch code, which reads/writes the new names exclusively. Production is
-- applied manually by Lewis via prod-backfill-071 in the same release.
--
-- Idempotent: column renames are guarded by an information_schema check; the
-- UPDATEs match nothing on a re-run.

BEGIN;

-- 1. Conversation type value (no CHECK constraint on conversations.type).
UPDATE public.conversations SET type = 'first_read' WHERE type = 'first_insight';

-- 2. wow message-id column on both wow tables. The UNIQUE/FK constraints and
--    indexes follow the column automatically; Supabase onConflict resolves by
--    column name, so the renamed cron upsert keeps working.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wow_assessments'
      AND column_name = 'first_insight_message_id'
  ) THEN
    ALTER TABLE public.wow_assessments RENAME COLUMN first_insight_message_id TO first_read_message_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'wow_events'
      AND column_name = 'first_insight_message_id'
  ) THEN
    ALTER TABLE public.wow_events RENAME COLUMN first_insight_message_id TO first_read_message_id;
  END IF;
END $$;

-- 3. Validation analytics events on user_events (free-text event_type).
UPDATE public.user_events SET event_type = 'first_read_validator_fired'
  WHERE event_type = 'first_insight_validator_fired';
UPDATE public.user_events SET event_type = 'first_read_chips_stripped'
  WHERE event_type = 'first_insight_chips_stripped';

COMMIT;
