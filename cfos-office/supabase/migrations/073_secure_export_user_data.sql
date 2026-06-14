-- 073_secure_export_user_data.sql
--
-- SECURITY FIX: add an authorization guard to public.export_user_data(uuid).
--
-- The function is SECURITY DEFINER (runs as its owner, bypassing RLS) but —
-- unlike its sibling public.delete_user_account(uuid) — it carried NO internal
-- check on the caller. Under Supabase defaults, functions in the public schema
-- are EXECUTE-able by anon and authenticated via PostgREST RPC
-- (POST /rest/v1/rpc/export_user_data), and no migration ever REVOKEd that
-- default. Net effect: any holder of the anon key could dump ANY user's full
-- dataset (profile, transactions, every conversation message, financial
-- portrait, goals, consent records, …) by passing a known or guessed user UUID
-- — a complete RLS bypass and GDPR data breach.
--
-- Fix — two layers of defense:
--   1. In-function guard, byte-identical to delete_user_account's (migration
--      070): a service_role caller is trusted; any other caller must be an
--      authenticated user whose auth.uid() matches p_user_id, else raise 42501.
--   2. Execute privileges: REVOKE from PUBLIC + anon (the anon key can no longer
--      reach the RPC at all); GRANT to authenticated (safe — the guard confines
--      them to their own data) and service_role (the legitimate app caller).
--      Mirrors the 062 lock-down precedent for refresh_merchant_aggregates.
--
-- The function body is otherwise preserved byte-for-byte from 070.
--
-- Legitimate caller — src/app/api/account/export/route.ts — is UNAFFECTED: it
-- uses the service-role client with the authenticated user's own id, so
-- auth.role() = 'service_role' and the guard is skipped.
--
-- Applied to staging (qlbhvlssksnrhsleadzn) by Claude and validated. Lewis
-- applies to production (iccelmjenljanqrhhzdv) by hand via the identical twin
-- prod-backfill-073_secure_export_user_data.sql.
--
-- ⚠️ MERGE ORDERING: an in-flight onboarding branch re-creates export_user_data
-- in 074_onboarding_estimates.sql with the body byte-preserved from 070 (i.e.
-- WITHOUT this guard). If that migration lands AFTER this one, its
-- CREATE OR REPLACE will silently re-open the hole. 074 must be rebased to carry
-- this guard before it merges. See the handover notes for Lewis.

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
