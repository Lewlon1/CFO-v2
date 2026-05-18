-- v2.2 — Profile-extraction candidates audit table
--
-- Stores medium-confidence (0.4 ≤ conf < 0.7) profile field extractions from
-- post-conversation analysis. High-confidence extractions write directly to
-- user_profiles; this table catches the ambiguous ones so they can be
-- surfaced later as follow-up questions or reviewed in admin tooling.

CREATE TABLE IF NOT EXISTS public.profile_extraction_candidates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  field_name      text NOT NULL,
  candidate_value jsonb NOT NULL,
  confidence      numeric NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence        text,
  applied         boolean NOT NULL DEFAULT false,
  applied_at      timestamptz,
  rejected        boolean NOT NULL DEFAULT false,
  rejected_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_profile_extraction_user_field
  ON public.profile_extraction_candidates (user_id, field_name, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.profile_extraction_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "extraction_select_own" ON public.profile_extraction_candidates;
CREATE POLICY "extraction_select_own"
  ON public.profile_extraction_candidates FOR SELECT
  USING (auth.uid() = user_id);
