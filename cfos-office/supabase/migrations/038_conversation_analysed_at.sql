-- 038_conversation_analysed_at.sql
--
-- Adds idempotency tracking for the post-conversation portrait extractor.
-- The extractor stamps `analysed_at` on terminal outcome (success or
-- explicit skip), so the daily fallback cron at /api/cron/portrait-extraction
-- can identify completed conversations that still need processing without
-- double-processing.
--
-- Applied to staging (qlbhvlssksnrhsleadzn) on 2026-05-03 via Claude Code.
-- Apply to prod manually — Lewis only.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS analysed_at timestamptz;

CREATE INDEX IF NOT EXISTS conversations_status_analysed_idx
  ON public.conversations (status, analysed_at)
  WHERE deleted_at IS NULL;
