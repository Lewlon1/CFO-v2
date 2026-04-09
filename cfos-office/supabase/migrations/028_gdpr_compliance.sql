-- Session 24, Part 4: GDPR compliance
--   4a. Soft-delete columns on all session-built tables
--   4b. consent_records (recreated with improved schema)
--   4c. dsar_requests (recreated with improved schema)
--   4d. delete_user_account() function
--   4e. export_user_data() function

-- 4a. Add deleted_at / anonymised_at to session-built tables
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.financial_portrait ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.value_map_results ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.value_map_sessions ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.value_category_rules ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.recurring_expenses ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.monthly_snapshots ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.goals ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.nudges ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.liabilities ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.investment_holdings ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.net_worth_snapshots ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.profiling_queue ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.message_feedback ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.llm_usage_log ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;
ALTER TABLE public.user_merchant_rules ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS anonymised_at timestamptz;

-- 4b. Consent records (replaces old consent_records dropped in 026)
CREATE TABLE IF NOT EXISTS public.consent_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  consent_type    text NOT NULL,         -- terms_of_service | privacy_policy | data_processing | marketing
  consent_version text NOT NULL,         -- e.g. '1.0'
  granted         boolean NOT NULL DEFAULT true,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  withdrawn_at    timestamptz,
  ip_hash         text,                  -- hashed IP, never raw
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consent_select_own" ON public.consent_records
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "consent_insert_own" ON public.consent_records
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_consent_user ON public.consent_records(user_id, consent_type);

-- 4c. DSAR requests (data subject access requests)
CREATE TABLE IF NOT EXISTS public.dsar_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  request_type    text NOT NULL CHECK (request_type IN ('export', 'delete', 'rectify', 'restrict')),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
  requested_at    timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  completed_at    timestamptz,
  deadline_at     timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dsar_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dsar_select_own" ON public.dsar_requests
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "dsar_insert_own" ON public.dsar_requests
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_dsar_user ON public.dsar_requests(user_id, status);

-- 4d. Account deletion function (called from API route with service role)
CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_counts jsonb := '{}';
  cnt integer;
BEGIN
  INSERT INTO public.dsar_requests (user_id, request_type, status, acknowledged_at, completed_at)
  VALUES (p_user_id, 'delete', 'completed', now(), now());

  DELETE FROM public.message_feedback WHERE user_id = p_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('message_feedback', cnt);

  DELETE FROM public.llm_usage_log WHERE user_id = p_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('llm_usage_log', cnt);

  DELETE FROM public.user_events WHERE profile_id = p_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('user_events', cnt);

  DELETE FROM public.messages WHERE conversation_id IN (
    SELECT id FROM public.conversations WHERE user_id = p_user_id
  );
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('messages', cnt);

  DELETE FROM public.conversations WHERE user_id = p_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('conversations', cnt);

  DELETE FROM public.monthly_snapshots WHERE user_id = p_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('monthly_snapshots', cnt);

  DELETE FROM public.recurring_expenses WHERE user_id = p_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('recurring_expenses', cnt);

  DELETE FROM public.transactions WHERE user_id = p_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('transactions', cnt);

  DELETE FROM public.financial_portrait WHERE user_id = p_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('financial_portrait', cnt);

  DELETE FROM public.profiling_queue WHERE user_id = p_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('profiling_queue', cnt);

  DELETE FROM public.value_map_results WHERE profile_id = p_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('value_map_results', cnt);

  DELETE FROM public.value_category_rules WHERE user_id = p_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('value_category_rules', cnt);

  DELETE FROM public.value_map_sessions WHERE profile_id = p_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('value_map_sessions', cnt);

  DELETE FROM public.action_items WHERE profile_id = p_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('action_items', cnt);

  DELETE FROM public.goals WHERE user_id = p_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('goals', cnt);

  DELETE FROM public.trips WHERE user_id = p_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('trips', cnt);

  DELETE FROM public.nudges WHERE user_id = p_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('nudges', cnt);

  DELETE FROM public.net_worth_snapshots WHERE user_id = p_user_id;
  DELETE FROM public.assets WHERE user_id = p_user_id;
  DELETE FROM public.liabilities WHERE user_id = p_user_id;
  DELETE FROM public.investment_holdings WHERE user_id = p_user_id;
  DELETE FROM public.accounts WHERE user_id = p_user_id;

  DELETE FROM public.user_merchant_rules WHERE user_id = p_user_id;

  DELETE FROM public.demo_question_responses WHERE session_id IN (
    SELECT id FROM public.demo_sessions WHERE profile_id = p_user_id
  );
  DELETE FROM public.demo_sessions WHERE profile_id = p_user_id;

  DELETE FROM public.consent_records WHERE user_id = p_user_id;

  DELETE FROM public.user_profiles WHERE id = p_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_counts := deleted_counts || jsonb_build_object('user_profiles', cnt);

  -- NOTE: the auth.users row must be deleted separately via supabase.auth.admin.deleteUser()
  -- from the API route that calls this function.

  RETURN deleted_counts;
END;
$$;

-- 4e. Full data export function (GDPR Article 20)
CREATE OR REPLACE FUNCTION public.export_user_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb := '{}';
BEGIN
  SELECT jsonb_build_object('profile', row_to_json(p))
  INTO result
  FROM public.user_profiles p WHERE p.id = p_user_id;

  result := result || jsonb_build_object('transactions', (
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    FROM public.transactions t WHERE t.user_id = p_user_id AND t.deleted_at IS NULL
  ));

  result := result || jsonb_build_object('conversations', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'conversation', row_to_json(c),
      'messages', (
        SELECT COALESCE(jsonb_agg(row_to_json(m) ORDER BY m.created_at), '[]'::jsonb)
        FROM public.messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL
      )
    )), '[]'::jsonb)
    FROM public.conversations c WHERE c.user_id = p_user_id AND c.deleted_at IS NULL
  ));

  result := result || jsonb_build_object('financial_portrait', (
    SELECT COALESCE(jsonb_agg(row_to_json(fp)), '[]'::jsonb)
    FROM public.financial_portrait fp WHERE fp.user_id = p_user_id AND fp.deleted_at IS NULL
  ));

  result := result || jsonb_build_object('goals', (
    SELECT COALESCE(jsonb_agg(row_to_json(g)), '[]'::jsonb)
    FROM public.goals g WHERE g.user_id = p_user_id AND g.deleted_at IS NULL
  ));

  result := result || jsonb_build_object('recurring_expenses', (
    SELECT COALESCE(jsonb_agg(row_to_json(re)), '[]'::jsonb)
    FROM public.recurring_expenses re WHERE re.user_id = p_user_id AND re.deleted_at IS NULL
  ));

  result := result || jsonb_build_object('monthly_snapshots', (
    SELECT COALESCE(jsonb_agg(row_to_json(ms)), '[]'::jsonb)
    FROM public.monthly_snapshots ms WHERE ms.user_id = p_user_id AND ms.deleted_at IS NULL
  ));

  result := result || jsonb_build_object('value_map_sessions', (
    SELECT COALESCE(jsonb_agg(row_to_json(vs)), '[]'::jsonb)
    FROM public.value_map_sessions vs WHERE vs.profile_id = p_user_id AND vs.deleted_at IS NULL
  ));

  result := result || jsonb_build_object('value_map_results', (
    SELECT COALESCE(jsonb_agg(row_to_json(vr)), '[]'::jsonb)
    FROM public.value_map_results vr WHERE vr.profile_id = p_user_id AND vr.deleted_at IS NULL
  ));

  result := result || jsonb_build_object('action_items', (
    SELECT COALESCE(jsonb_agg(row_to_json(ai)), '[]'::jsonb)
    FROM public.action_items ai WHERE ai.profile_id = p_user_id AND ai.deleted_at IS NULL
  ));

  result := result || jsonb_build_object('trips', (
    SELECT COALESCE(jsonb_agg(row_to_json(tr)), '[]'::jsonb)
    FROM public.trips tr WHERE tr.user_id = p_user_id AND tr.deleted_at IS NULL
  ));

  result := result || jsonb_build_object('consent_records', (
    SELECT COALESCE(jsonb_agg(row_to_json(cr)), '[]'::jsonb)
    FROM public.consent_records cr WHERE cr.user_id = p_user_id
  ));

  result := result || jsonb_build_object(
    'exported_at', now(),
    'export_version', '1.0'
  );

  INSERT INTO public.user_events (profile_id, event_type, event_category, payload)
  VALUES (p_user_id, 'data_export_requested', 'system', '{"type": "full_export"}'::jsonb);

  RETURN result;
END;
$$;
