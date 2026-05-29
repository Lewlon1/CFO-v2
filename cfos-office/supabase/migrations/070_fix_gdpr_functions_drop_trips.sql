-- 070_fix_gdpr_functions_drop_trips.sql
--
-- Fixes both GDPR SECURITY DEFINER functions, which referenced public.trips —
-- a table dropped in the v2.5 IA simplification (trips folded into
-- goals/travel-events; `/trips` → `/office/goals/travel-events`). The dead
-- reference made both functions fail at runtime with:
--   ERROR: 42P01: relation "public.trips" does not exist
--
-- Impact (production): account deletion (/api/account/delete → delete_user_account)
-- and data export (/api/account/export → export_user_data) were BROKEN for every
-- user. Surfaced 2026-05-29 while running the Audit Zero prod cleanup.
--
-- export_user_data had a second latent bug: it read action_items by a
-- non-existent `profile_id` column (the column is `user_id`) — corrected here.
--
-- Both functions are otherwise preserved byte-for-byte. Applied to staging
-- (qlbhvlssksnrhsleadzn) 2026-05-29 and validated: delete_user_account runs
-- clean against a dummy uuid; export_user_data returns all 13 data keys against
-- a real user. Lewis applies to production.
--
-- NOTE: a follow-up should audit the remaining SECURITY DEFINER functions
-- (fn_import_batches, get_import_history, prediction_metrics_txn) and any other
-- SQL bodies for further references to dropped tables — this whole class of bug
-- was invisible to the Audit Zero code sweep, which only scanned `.from()` calls
-- in TypeScript, not SQL function bodies.

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
