-- prod-backfill-071_rename_first_insight_to_first_read.sql
--
-- ⚠️ PRODUCTION-ONLY, MANUAL. Lewis runs this by hand against
-- iccelmjenljanqrhhzdv, in the SAME release that ships the v2.7 branch code.
-- It is NOT applied by automation.
--
-- This is identical to the staging migration 071. The rename must land on prod
-- atomically with the deploy: the code reads/writes 'first_read' + the
-- first_read_message_id column exclusively, so a deploy without this migration
-- (or this migration without the deploy) breaks the wow pipeline + the Read
-- conversation lookup until both are in place.
--
-- Recommended: run inside the transaction below and eyeball the row counts
-- (the preview SELECTs report what each step will touch) before COMMIT.
--
-- Scope = concept #1 only (conversation type + wow message-id column + the two
-- validation analytics events). It does NOT rename the "computed insight
-- payload" concept (conversations.metadata.first_insight_payload), which keeps
-- its name in code.

-- ── Preview (run first, outside the transaction, to size the change) ─────────
-- SELECT count(*) AS convs_to_rename       FROM public.conversations WHERE type = 'first_insight';
-- SELECT count(*) AS validator_events      FROM public.user_events   WHERE event_type = 'first_insight_validator_fired';
-- SELECT count(*) AS chip_strip_events     FROM public.user_events   WHERE event_type = 'first_insight_chips_stripped';
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name IN ('wow_assessments','wow_events')
--     AND column_name='first_insight_message_id';

BEGIN;

UPDATE public.conversations SET type = 'first_read' WHERE type = 'first_insight';

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

UPDATE public.user_events SET event_type = 'first_read_validator_fired'
  WHERE event_type = 'first_insight_validator_fired';
UPDATE public.user_events SET event_type = 'first_read_chips_stripped'
  WHERE event_type = 'first_insight_chips_stripped';

COMMIT;
