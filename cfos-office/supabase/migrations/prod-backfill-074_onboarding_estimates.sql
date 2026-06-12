-- prod-backfill-074_onboarding_estimates.sql
--
-- ⚠️ PROD BACKFILL — DO NOT auto-apply.
--
-- This file mirrors 074_onboarding_estimates.sql exactly. It is applied by
-- hand to the production Supabase project (iccelmjenljanqrhhzdv) by Lewis,
-- in the SAME release that ships the estimates-first onboarding (OB) branch
-- to main. Staging (qlbhvlssksnrhsleadzn) gets the migration via the normal
-- apply_migration path.
--
-- Contents: the onboarding_estimates table (band taps, income, verdicts,
-- derive() output, per-band verification) + RLS (SELECT/INSERT/UPDATE only
-- — a DELETE policy is deliberately omitted; rows are removed via
-- delete_user_account or the user_profiles cascade) + updated_at trigger,
-- re-creations of both GDPR SECURITY DEFINER functions, and a REVOKE/GRANT
-- lockdown of both (service_role-only EXECUTE, 062 precedent).
-- delete_user_account is the 070 prod definition preserved byte-for-byte
-- plus the onboarding_estimates delete; export_user_data is the 070 prod
-- definition preserved byte-for-byte EXCEPT two additions: the
-- caller-authorization guard its sibling already carries (defense-in-depth
-- behind the revoke) and the onboarding_estimates export block.

CREATE TABLE public.onboarding_estimates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  currency        TEXT NOT NULL DEFAULT 'EUR',
  -- Band IDs only; midpoints live in the versioned TS engine, never the DB.
  housing_band    TEXT,
  subs_band       TEXT,
  bills_band      TEXT,
  food_out_band   TEXT,
  save_reach_band TEXT,
  -- Sanity bound only (named constraint). Product-range validation
  -- (500–50,000) lives in the TS layer (server action; the derive engine
  -- documents income > 0 as an input contract), per this file's design
  -- stance that business numbers stay out of the schema.
  income_monthly  NUMERIC CONSTRAINT onboarding_estimates_income_monthly_check
                    CHECK (income_monthly IS NULL OR (income_monthly > 0 AND income_monthly < 1000000)),
  top_value       TEXT,
  -- e.g. {"subscriptions":"leak","food_out":"worth_it","drift":"unsure"}
  verdicts        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- derive() engine output incl. engine_version. NULL until the engine runs.
  derived         JSONB,
  -- Engine-versioned, once a statement is checked:
  -- {"engine_version":"v1","bands":{"housing":{"state":"verified","estimate":650,"actual":612,"delta":-38},...}}
  verification    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- user_id is UNIQUE, which already gives the per-user lookup its index —
-- no additional index needed.

ALTER TABLE public.onboarding_estimates ENABLE ROW LEVEL SECURITY;

-- (select auth.uid()) wrapping per the standing auth_rls_initplan rule.
CREATE POLICY onboarding_estimates_select
  ON public.onboarding_estimates
  FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY onboarding_estimates_insert
  ON public.onboarding_estimates
  FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY onboarding_estimates_update
  ON public.onboarding_estimates
  FOR UPDATE
  USING ((SELECT auth.uid()) = user_id);

-- updated_at trigger (canonical handle_updated_at function from 004).
CREATE TRIGGER onboarding_estimates_set_updated_at
  BEFORE UPDATE ON public.onboarding_estimates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

COMMENT ON TABLE public.onboarding_estimates IS
  'OB-1 estimates-first onboarding: one row per user. Band taps (IDs only — ranges live in the TS engine), income, verdicts, derive() output, and later per-band verification against a real statement.';
COMMENT ON COLUMN public.onboarding_estimates.derived IS
  'OB-1: deterministic derive() engine output, incl. engine_version. NULL until computed.';
COMMENT ON COLUMN public.onboarding_estimates.verification IS
  'OB-1: engine-versioned per-band verification once a statement is checked, e.g. {"engine_version":"v1","bands":{"housing":{"state":"verified","estimate":650,"actual":612,"delta":-38}}}. Empty object until the statement-check mission runs.';

-- ----------------------------------------------------------------------------
-- GDPR function amendments. delete_user_account is the 070 definition
-- preserved byte-for-byte plus the onboarding_estimates delete.
-- export_user_data is the 070 definition preserved byte-for-byte EXCEPT two
-- additions: the caller-authorization guard (the same block its sibling
-- delete_user_account carries) and the onboarding_estimates export block.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_user_account(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  deleted_counts jsonb := '{}';
  cnt integer;
begin
  if auth.role() <> 'service_role' then
    if auth.uid() is null or auth.uid() <> p_user_id then
      raise exception 'unauthorized: caller does not match p_user_id'
        using errcode = '42501';
    end if;
  end if;

  delete from public.message_feedback where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('message_feedback', cnt);

  delete from public.llm_usage_log where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('llm_usage_log', cnt);

  delete from public.user_events where profile_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('user_events', cnt);

  delete from public.correction_signals where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('correction_signals', cnt);

  delete from public.messages where conversation_id in (
    select id from public.conversations where user_id = p_user_id
  );
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('messages', cnt);

  delete from public.conversations where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('conversations', cnt);

  delete from public.monthly_snapshots where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('monthly_snapshots', cnt);

  delete from public.recurring_expenses where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('recurring_expenses', cnt);

  delete from public.transactions where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('transactions', cnt);

  delete from public.financial_portrait where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('financial_portrait', cnt);

  delete from public.profiling_queue where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('profiling_queue', cnt);

  delete from public.value_map_results where profile_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('value_map_results', cnt);

  delete from public.value_category_rules where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('value_category_rules', cnt);

  delete from public.value_map_sessions where profile_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('value_map_sessions', cnt);

  delete from public.action_items where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('action_items', cnt);

  delete from public.goal_contributions where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('goal_contributions', cnt);

  delete from public.goals where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('goals', cnt);

  delete from public.nudges where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('nudges', cnt);

  delete from public.net_worth_snapshots where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('net_worth_snapshots', cnt);

  delete from public.assets where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('assets', cnt);

  delete from public.liabilities where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('liabilities', cnt);

  delete from public.investment_holdings where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('investment_holdings', cnt);

  delete from public.accounts where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('accounts', cnt);

  delete from public.user_merchant_rules where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('user_merchant_rules', cnt);

  delete from public.consent_records where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('consent_records', cnt);

  delete from public.onboarding_estimates where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('onboarding_estimates', cnt);

  delete from public.user_profiles where id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('user_profiles', cnt);

  return deleted_counts;
end;
$function$;

CREATE OR REPLACE FUNCTION public.export_user_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb := '{}';
BEGIN
  -- Same guard as delete_user_account. Defense-in-depth behind the
  -- REVOKE/GRANT lockdown at the end of this file.
  if auth.role() <> 'service_role' then
    if auth.uid() is null or auth.uid() <> p_user_id then
      raise exception 'unauthorized: caller does not match p_user_id'
        using errcode = '42501';
    end if;
  end if;

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
    FROM public.action_items ai WHERE ai.user_id = p_user_id AND ai.deleted_at IS NULL
  ));

  result := result || jsonb_build_object('consent_records', (
    SELECT COALESCE(jsonb_agg(row_to_json(cr)), '[]'::jsonb)
    FROM public.consent_records cr WHERE cr.user_id = p_user_id
  ));

  result := result || jsonb_build_object('onboarding_estimates', (
    SELECT COALESCE(jsonb_agg(row_to_json(oe)), '[]'::jsonb)
    FROM public.onboarding_estimates oe WHERE oe.user_id = p_user_id
  ));

  result := result || jsonb_build_object(
    'exported_at', now(),
    'export_version', '1.0'
  );

  INSERT INTO public.user_events (profile_id, event_type, event_category, payload)
  VALUES (p_user_id, 'data_export_requested', 'system', '{"type": "full_export"}'::jsonb);

  RETURN result;
END;
$function$;

-- ----------------------------------------------------------------------------
-- Lock down both GDPR RPCs (062 precedent): functions default EXECUTE to
-- PUBLIC, and PostgREST exposes them to anon/authenticated unless explicitly
-- revoked. The only legitimate caller is the app server via the service-role
-- client (src/app/api/account/export/route.ts, src/app/api/account/delete/
-- route.ts, src/app/api/profile/delete-data/route.ts), which authenticates
-- the user itself before calling. The in-function auth guards above are
-- defense-in-depth behind this revoke.
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.delete_user_account(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_user_account(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_user_account(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_account(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.export_user_data(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.export_user_data(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.export_user_data(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.export_user_data(uuid) TO service_role;
