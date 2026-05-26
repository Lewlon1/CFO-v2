-- Prod backfill mirror of 065_wow_events.sql.
-- Apply manually to production after staging validation.

CREATE TYPE wow_event_type AS ENUM (
  'delivered',
  'scrolled_to_bottom',
  'chip_tapped',
  'replied_substantively',
  'resonance_tap_positive',
  'resonance_tap_negative',
  'returned_d2'
);

CREATE TABLE public.wow_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  first_insight_message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  event_type wow_event_type NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX wow_events_idempotent
  ON public.wow_events (first_insight_message_id, event_type)
  WHERE event_type IN (
    'delivered',
    'scrolled_to_bottom',
    'returned_d2',
    'resonance_tap_positive',
    'resonance_tap_negative'
  );

CREATE INDEX wow_events_user_insight
  ON public.wow_events (user_id, first_insight_message_id);

CREATE INDEX wow_events_created
  ON public.wow_events (created_at DESC);

ALTER TABLE public.wow_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY wow_events_select_own ON public.wow_events FOR SELECT
  USING ((select auth.uid()) = user_id);
CREATE POLICY wow_events_insert_own ON public.wow_events FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

COMMENT ON TABLE public.wow_events IS
  'Append-only behavioural events captured when a user encounters the first Read. Feeds the nightly aggregation that computes realised_wow_score.';
