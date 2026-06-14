-- prod-backfill-073_secure_export_user_data.sql
--
-- ⚠️ PRODUCTION-ONLY, MANUAL. Lewis runs this by hand against
-- iccelmjenljanqrhhzdv. It is NOT applied by automation.
--
-- This is identical to the staging migration 073 (same function definition,
-- same REVOKE/GRANT), wrapped in a transaction with a verification query so the
-- whole change lands atomically.
--
-- SECURITY FIX: public.export_user_data(uuid) is SECURITY DEFINER (bypasses RLS)
-- but had NO caller check, while under Supabase defaults it was EXECUTE-able by
-- anon/authenticated via PostgREST RPC. Any holder of the anon key could dump
-- ANY user's full dataset by passing a known/guessed UUID. This adds the same
-- guard delete_user_account has (migration 070) and locks down EXECUTE.
--
-- The legitimate caller (/api/account/export → service-role client with the
-- user's own id) is unaffected: auth.role() = 'service_role' skips the guard.
--
-- ⚠️ MERGE ORDERING: the in-flight onboarding branch's 074_onboarding_estimates
-- re-creates export_user_data WITHOUT this guard (body byte-preserved from 070).
-- If 074 is applied to prod after this file, it re-opens the hole. Apply this
-- only once 074 has been rebased to carry the guard, or re-apply this after 074.

-- ── Verify the privilege change after COMMIT (expect anon ABSENT; authenticated
--    and service_role PRESENT with EXECUTE) ──────────────────────────────────
-- SELECT grantee, privilege_type
--   FROM information_schema.role_routine_grants
--   WHERE routine_schema = 'public' AND routine_name = 'export_user_data'
--   ORDER BY grantee;

BEGIN;

CREATE OR REPLACE FUNCTION public.export_user_data(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb := '{}';
BEGIN
  -- Authorization guard (identical to delete_user_account, migration 070):
  -- trust service_role; otherwise the caller must be the authenticated owner.
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

  result := result || jsonb_build_object(
    'exported_at', now(),
    'export_version', '1.0'
  );

  INSERT INTO public.user_events (profile_id, event_type, event_category, payload)
  VALUES (p_user_id, 'data_export_requested', 'system', '{"type": "full_export"}'::jsonb);

  RETURN result;
END;
$function$;

-- Lock down execute privileges (mirrors 062's refresh_merchant_aggregates):
-- anon must not reach this RPC at all; authenticated may call it but the guard
-- above confines them to their own data; service_role is the legitimate app path.
REVOKE EXECUTE ON FUNCTION public.export_user_data(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.export_user_data(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.export_user_data(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_user_data(uuid) TO service_role;

COMMIT;
