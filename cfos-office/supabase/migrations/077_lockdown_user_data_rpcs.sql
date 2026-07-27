-- 077_lockdown_user_data_rpcs.sql
--
-- SECURITY FIX + REPRODUCIBILITY: lock down the SECURITY DEFINER user-data RPCs.
--
-- Three RPCs — get_import_history, fn_import_batches, prediction_metrics_txn —
-- are SECURITY DEFINER (they run as owner, bypassing RLS) and take a user id as
-- an argument. Without an internal caller guard, and while EXECUTE is granted to
-- anon/PUBLIC by Supabase default, any holder of the anon key can call them via
-- PostgREST RPC with a guessed/known UUID and read ANOTHER user's data
-- (statement import history, import batches, prediction metrics). Companion to
-- 073_secure_export_user_data.sql, which closed the same class of hole on
-- export_user_data.
--
-- This adds the same guard delete_user_account/export_user_data carry (trust
-- service_role; otherwise the caller must be the authenticated owner), pins
-- search_path, and revokes anon/PUBLIC EXECUTE. It also drops the dead
-- fn_session_feedback(uuid) RPC.
--
-- HISTORY / WHY THIS FILE EXISTS: this hardening was applied to staging on
-- 2026-05-06 as ad-hoc migrations p2_fix_idor_user_data_rpcs /
-- p4_drop_dead_fn_session_feedback / p5_pin_function_search_paths, which were
-- never committed as files — so the repo could not reproduce the hardened
-- state and production never received it. Bodies below are copied verbatim from
-- the current staging definitions (the source of truth). The migration is
-- idempotent (CREATE OR REPLACE + REVOKE/GRANT + DROP IF EXISTS).
--
-- ⚠️ CLOBBER HAZARD: export_user_data's guard was previously added, then dropped
-- by a later CREATE OR REPLACE that omitted it, then re-added. Any future
-- migration that recreates one of these four functions MUST re-include the guard
-- and re-issue the REVOKEs, or it silently re-opens the RLS-bypass. Keep the
-- guard block in every redefinition.

-- ── get_import_history(uuid) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_import_history(p_user_id uuid)
 RETURNS TABLE(import_batch_id uuid, source text, transaction_count bigint, earliest_date timestamp with time zone, latest_date timestamp with time zone, imported_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (select auth.uid()) is null or (select auth.uid()) <> p_user_id then
    raise exception 'unauthorized: caller does not match p_user_id'
      using errcode = '42501';
  end if;

  return query
    select t.import_batch_id, t.source, count(*) as transaction_count,
           min(t.date) as earliest_date, max(t.date) as latest_date,
           min(t.created_at) as imported_at
    from public.transactions t
    where t.user_id = p_user_id and t.import_batch_id is not null
    group by t.import_batch_id, t.source
    order by min(t.created_at) desc;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_import_history(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_import_history(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_import_history(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_import_history(uuid) TO service_role;

-- ── fn_import_batches(uuid) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_import_batches(p_profile_id uuid)
 RETURNS TABLE(import_batch_id uuid, imported_at timestamp with time zone, tx_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (select auth.uid()) is null or (select auth.uid()) <> p_profile_id then
    raise exception 'unauthorized: caller does not match p_profile_id'
      using errcode = '42501';
  end if;

  return query
    select t.import_batch_id, min(t.created_at) as imported_at, count(*) as tx_count
    from public.transactions t
    where t.user_id = p_profile_id and t.import_batch_id is not null
    group by t.import_batch_id
    order by min(t.created_at) desc;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_import_batches(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_import_batches(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_import_batches(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_import_batches(uuid) TO service_role;

-- ── prediction_metrics_txn(uuid) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prediction_metrics_txn(p_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (select auth.uid()) is null or (select auth.uid()) <> p_user_id then
    raise exception 'unauthorized: caller does not match p_user_id'
      using errcode = '42501';
  end if;

  return (select json_build_object(
    'total', count(*),
    'confirmed', count(*) filter (where prediction_source = 'user_confirmed'),
    'predicted', count(*) filter (where prediction_source is not null and prediction_source != 'user_confirmed' and value_category != 'no_idea'),
    'uncategorised', count(*) filter (where value_category = 'no_idea' or value_category is null),
    'avg_confidence', round(avg(value_confidence) filter (where prediction_source is not null and prediction_source != 'user_confirmed'), 2),
    'high_confidence_pct', round(
      count(*) filter (where value_confidence >= 0.75 and prediction_source != 'user_confirmed')::numeric
      / nullif(count(*) filter (where prediction_source is not null and prediction_source != 'user_confirmed'), 0),
      2
    ),
    'low_confidence_pct', round(
      count(*) filter (where value_confidence < 0.25 and prediction_source != 'user_confirmed')::numeric
      / nullif(count(*) filter (where prediction_source is not null and prediction_source != 'user_confirmed'), 0),
      2
    )
  )
  from public.transactions
  where user_id = p_user_id);
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.prediction_metrics_txn(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prediction_metrics_txn(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.prediction_metrics_txn(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.prediction_metrics_txn(uuid) TO service_role;

-- ── drop dead RPC ───────────────────────────────────────────────────────────
-- fn_session_feedback(uuid) is unused (dropped on staging as p4). It is
-- SECURITY DEFINER and anon-executable on any environment that still carries it.
DROP FUNCTION IF EXISTS public.fn_session_feedback(uuid);
