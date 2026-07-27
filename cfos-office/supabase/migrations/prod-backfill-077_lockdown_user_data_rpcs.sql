-- prod-backfill-077_lockdown_user_data_rpcs.sql
--
-- ⚠️ PRODUCTION-ONLY, MANUAL. Lewis runs this by hand against
-- iccelmjenljanqrhhzdv. It is NOT applied by automation.
--
-- Identical DDL to the staging migration 077_lockdown_user_data_rpcs.sql, wrapped
-- in a transaction with a verification query so the whole change lands atomically.
--
-- SECURITY FIX: on production, get_import_history / fn_import_batches /
-- prediction_metrics_txn are SECURITY DEFINER (bypass RLS), carry NO caller
-- guard, and are EXECUTE-able by anon/PUBLIC via PostgREST RPC. Any holder of
-- the anon key can pass a known/guessed user UUID and read that user's statement
-- import history, import batches, and prediction metrics. fn_session_feedback is
-- a dead SECURITY DEFINER RPC still callable by anon. Production never received
-- the 2026-05-06 staging hardening (p2/p4/p5); this backfill applies it.
--
-- Apply this TOGETHER WITH prod-backfill-073_secure_export_user_data.sql, which
-- closes the same hole on export_user_data. After both run, production matches
-- staging: all four user-data RPCs guarded, anon EXECUTE revoked, search_path
-- pinned, and fn_session_feedback removed.
--
-- The legitimate callers (server-side API routes using the service-role client
-- with the user's own id) are unaffected: auth.role() is not checked here, and
-- the guard compares the authenticated caller — the app already passes the
-- session user's id, exactly as it does against staging.
--
-- ⚠️ CLOBBER HAZARD: these guards can be silently undone by any later
-- CREATE OR REPLACE that omits the guard block. If a future onboarding/GDPR
-- migration recreates any of these functions on prod, re-apply this file after
-- it, or fold the guard into that migration.
--
-- ── Verify after COMMIT (expect anon ABSENT for all four; fn_session_feedback
--    gone) ─────────────────────────────────────────────────────────────────────
-- SELECT p.proname, r.grantee, r.privilege_type
--   FROM information_schema.role_routine_grants r
--   JOIN pg_proc p ON p.proname = r.routine_name
--   WHERE r.routine_schema = 'public'
--     AND r.routine_name IN ('get_import_history','fn_import_batches','prediction_metrics_txn')
--   ORDER BY p.proname, r.grantee;
-- SELECT count(*) AS fn_session_feedback_still_present
--   FROM pg_proc WHERE proname = 'fn_session_feedback';   -- expect 0

BEGIN;

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
DROP FUNCTION IF EXISTS public.fn_session_feedback(uuid);

COMMIT;
