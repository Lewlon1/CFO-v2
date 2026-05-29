-- prod-backfill — Session 32 (A) — chat_signals (Layer 4)
-- DO NOT auto-apply. Lewis runs this manually against the production project
-- (iccelmjenljanqrhhzdv) after a final review during the eventual session-32 merge.
--
-- Equivalent to staging migration 063_chat_signals.sql.

CREATE TYPE chat_signal_type AS ENUM (
  'regret',
  'enjoyment',
  'context_person',
  'context_event',
  'context_situation'
);

CREATE TYPE chat_signal_extraction_method AS ENUM ('pattern', 'llm');

CREATE TABLE public.chat_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  signal_type chat_signal_type NOT NULL,
  target_merchant TEXT,
  target_category TEXT,
  marker_phrase TEXT NOT NULL,
  confidence NUMERIC(3,2) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  extraction_method chat_signal_extraction_method NOT NULL,
  raw_message_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX chat_signals_user_created
  ON public.chat_signals(user_id, created_at DESC);
CREATE INDEX chat_signals_user_merchant
  ON public.chat_signals(user_id, target_merchant)
  WHERE target_merchant IS NOT NULL;
CREATE INDEX chat_signals_user_category
  ON public.chat_signals(user_id, target_category)
  WHERE target_category IS NOT NULL;

ALTER TABLE public.chat_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_signals_select_own ON public.chat_signals FOR SELECT
  USING ((select auth.uid()) = user_id);
CREATE POLICY chat_signals_insert_own ON public.chat_signals FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

COMMENT ON TABLE public.chat_signals IS
  'Layer 4: Conversational signals (regret/enjoyment/context) extracted from chat messages. Pattern-first, Haiku LLM fallback.';
