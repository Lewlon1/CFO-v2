-- Prod backfill mirror of 066_wow_assessments.sql.
-- Apply manually to production after staging validation. Depends on 065_wow_events.

CREATE TABLE public.wow_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  first_insight_message_id UUID NOT NULL UNIQUE
    REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ NOT NULL,

  predicted_wow_score NUMERIC(4,3),
  judge_id TEXT,

  realised_wow_score NUMERIC(4,3),
  in_session_score  NUMERIC(4,3),
  overnight_score   NUMERIC(4,3),
  last_aggregated_at TIMESTAMPTZ,

  gap_present BOOLEAN NOT NULL DEFAULT FALSE,
  layers_used     JSONB NOT NULL DEFAULT '[]'::jsonb,
  features_cited  JSONB NOT NULL DEFAULT '[]'::jsonb,
  clusters_referenced JSONB NOT NULL DEFAULT '[]'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX wow_assessments_user_delivered
  ON public.wow_assessments (user_id, delivered_at DESC);
CREATE INDEX wow_assessments_realised_score
  ON public.wow_assessments (realised_wow_score DESC NULLS LAST);
CREATE INDEX wow_assessments_judge
  ON public.wow_assessments (judge_id, delivered_at DESC)
  WHERE judge_id IS NOT NULL;

ALTER TABLE public.wow_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY wow_assessments_select_own ON public.wow_assessments FOR SELECT
  USING ((select auth.uid()) = user_id);

COMMENT ON TABLE public.wow_assessments IS
  'Per-first-insight predicted vs realised wow scores. Updated nightly by /api/cron/wow-aggregate. Composition metadata snapshotted from conversations.metadata.first_read_metadata.';
