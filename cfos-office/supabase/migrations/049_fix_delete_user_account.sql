-- 049_fix_delete_user_account.sql
--
-- Repairs public.delete_user_account(uuid) so the Settings → Danger zone
-- "Delete my account" flow can complete. Two distinct bugs were stacked on
-- the live function:
--
--   1. An IDOR guard introduced by an uncommitted staging-only migration
--      (p2_fix_idor_user_data_rpcs, 2026-05-06) rejected every call because
--      auth.uid() is NULL when the API route invokes the function via the
--      service role client. The IDOR concern itself is legitimate — without
--      a guard, any authenticated user could pass another user's UUID to a
--      SECURITY DEFINER function. The new guard keeps the check for direct
--      authenticated callers and bypasses it only when auth.role() is
--      'service_role'.
--
--   2. The first statement INSERTed a row into public.dsar_requests, which
--      was dropped by migration 047_drop_dead_tables. The audit row is gone
--      from this function; if a persistent deletion audit is wanted later
--      it can be reintroduced via user_events or a new table.
--
-- This migration also reconciles two schema drifts that left the prod copy
-- of the function broken in its own way: action_items.profile_id was
-- renamed to user_id in 024, and goal_contributions (044) / correction_signals
-- (031) were never covered.
--
-- CREATE OR REPLACE keeps signature and existing grants intact.

create or replace function public.delete_user_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_counts jsonb := '{}';
  cnt integer;
begin
  -- IDOR guard: a direct authenticated caller may only delete their own
  -- account. The service role (used by the API route after it has already
  -- validated the user via supabase.auth.getUser()) is trusted and skips
  -- the check.
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

  -- messages → conversations (child first)
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

  -- goal_contributions → goals (child first, even though goals cascade)
  delete from public.goal_contributions where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('goal_contributions', cnt);

  delete from public.goals where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('goals', cnt);

  delete from public.trips where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('trips', cnt);

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

  -- demo_sessions / demo_question_responses are anonymous pre-signup demo
  -- tracking — no FK to user_profiles — so nothing to wipe here.

  delete from public.consent_records where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('consent_records', cnt);

  delete from public.user_profiles where id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('user_profiles', cnt);

  -- NOTE: the auth.users row must be deleted separately via
  -- supabase.auth.admin.deleteUser() from the API route that calls this
  -- function. See cfos-office/src/app/api/account/delete/route.ts.

  return deleted_counts;
end;
$$;
