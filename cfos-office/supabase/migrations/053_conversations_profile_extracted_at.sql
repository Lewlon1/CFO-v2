-- v2.2 — Track when post-conversation profile-field extraction has run.
--
-- Mirrors the existing `analysed_at` column used by the portrait extractor.
-- Stamped on terminal outcomes (success or "too few messages") so the daily
-- cron at /api/cron/profile-extraction can pick up only what the primary
-- `after()` path missed.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS profile_extracted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_conversations_profile_extracted_at
  ON public.conversations (updated_at DESC)
  WHERE profile_extracted_at IS NULL
    AND status = 'completed'
    AND deleted_at IS NULL;
