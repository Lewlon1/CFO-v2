-- 083_read_feedback.sql
--
-- Adds public.read_feedback — hard, actionable feedback on the First Read.
--
-- WHY: the only feedback channels on a Read were two ratings — MessageFeedback's
-- thumbs and ResonanceTap's "did this read you right?". Both yield a number you
-- cannot act on. When C. states a figure that is simply wrong, a beta user had
-- nowhere to say so. This table is the other thing: one row per reported error,
-- in the user's own words, stored with enough context to become a diff.
--
-- Each row carries the Read's identity (first_read_message_id — the same
-- messages.id that wow_assessments keys on UNIQUE, so realised wow and error
-- reports join directly), the exact prose the user was looking at
-- (read_snapshot), and the computed figures that Read actually cited
-- (citation_set). Snapshotted at report time rather than joined at read time,
-- because the recompose and declared-upgrade paths overwrite
-- conversations.metadata.first_read_metadata underneath a report.
--
-- Written by src/app/api/reads/feedback/route.ts, from
-- src/components/chat/ReadErrorReport.tsx. Read by /admin/wow/[insightId].
--
-- Apply to staging (qlbhvlssksnrhsleadzn) via the normal apply_migration path.
-- Prod (iccelmjenljanqrhhzdv) gets the companion prod-backfill-083, run by hand.
-- Additive; idempotent via `if not exists` / `drop policy if exists`.
--
-- ⚠️ CLOBBER HAZARD (same as 082): sections 2 and 3 CREATE OR REPLACE the two
-- GDPR RPCs purely to teach them about read_feedback. Their bodies are copied
-- from 082_memory_files.sql — the CURRENT LATEST definitions — and preserve,
-- byte-for-byte, export_user_data's `auth.role() <> 'service_role'` guard
-- raising 42501, both functions' SET search_path TO 'public', and
-- export_user_data's REVOKE/GRANT lock-down (re-issued below). A future
-- migration adding a user-scoped table must copy from THIS file, not an older one.

-- ---------------------------------------------------------------------------
-- 1. read_feedback
-- ---------------------------------------------------------------------------

create table if not exists public.read_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  first_read_message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  read_snapshot text,
  citation_set jsonb not null default '[]'::jsonb,
  read_context jsonb not null default '{}'::jsonb,
  status text not null default 'new'
    check (status in ('new', 'triaged', 'fixed', 'invalid')),
  created_at timestamptz not null default now()
);

-- Deliberately NOT unique on first_read_message_id: one Read can be wrong in
-- more than one way, and a user who finds a second error must be able to say so.
create index if not exists read_feedback_read_idx
  on public.read_feedback (first_read_message_id, created_at desc);

-- Triage queue: the only status anyone scans for is 'new'.
create index if not exists read_feedback_triage_idx
  on public.read_feedback (created_at desc)
  where status = 'new';

alter table public.read_feedback enable row level security;

-- Select + insert own only. Reports are append-only from the user's side —
-- no update/delete policy, so a filed report cannot be edited or withdrawn
-- from the client. Triage moves `status` via the service client, which
-- bypasses RLS. (select auth.uid()) wrapping per the auth_rls_initplan rule.
drop policy if exists read_feedback_select_own on public.read_feedback;
create policy read_feedback_select_own on public.read_feedback for select
  using ((select auth.uid()) = user_id);

drop policy if exists read_feedback_insert_own on public.read_feedback;
create policy read_feedback_insert_own on public.read_feedback for insert
  with check ((select auth.uid()) = user_id);

comment on table public.read_feedback is
  'User-reported errors in a First Read. One row per report, in the user''s own words, keyed to the same first_read_message_id wow_assessments uses so realised wow and error reports join. Written by src/app/api/reads/feedback/route.ts.';

comment on column public.read_feedback.body is
  'The report, as the user typed it. Capped at 2000 chars, matching the client textarea and the route''s zod schema.';

comment on column public.read_feedback.read_snapshot is
  'The exact Read prose the user was looking at when they reported, copied from messages.content at report time. Nullable so a report is never lost to a failed lookup.';

comment on column public.read_feedback.citation_set is
  'The computed figures this Read actually cited, each tagged with the fact bundle that produced it: [{"value":340,"source":"spending_breakdown"}]. Snapshotted from conversations.metadata.first_read_metadata at report time, because recompose overwrites that metadata. Empty for Reads composed before 083 shipped.';

comment on column public.read_feedback.read_context is
  'Composition context snapshotted at report time — mode, read_recipe, layers_used, is_recompose — so reports can be sliced by how the Read was built.';

comment on column public.read_feedback.status is
  'Triage state: new | triaged | fixed | invalid. Moved by hand via the service client; there is no user-facing or admin UI for it yet.';

-- ---------------------------------------------------------------------------
-- 2. GDPR — export_user_data(uuid)
-- ---------------------------------------------------------------------------
-- Body copied from 082_memory_files.sql (the current latest definition), with
-- read_feedback added. The authorization guard, SET search_path and the
-- REVOKE/GRANT lock-down are preserved — see the CLOBBER HAZARD note at the
-- top of this file.
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

  -- Added in 082: the filing cabinet. Archived files are included on purpose —
  -- a soft-archived file is still the user's data and is still restorable.
  result := result || jsonb_build_object('memory_files', (
    SELECT COALESCE(jsonb_agg(row_to_json(mf)), '[]'::jsonb)
    FROM public.memory_files mf WHERE mf.user_id = p_user_id
  ));

  result := result || jsonb_build_object('memory_file_revisions', (
    SELECT COALESCE(jsonb_agg(row_to_json(mfr)), '[]'::jsonb)
    FROM public.memory_file_revisions mfr WHERE mfr.user_id = p_user_id
  ));

  -- Added in 083 — error reports the user filed against a First Read. Their
  -- own words about our numbers; unambiguously their data.
  result := result || jsonb_build_object('read_feedback', (
    SELECT COALESCE(jsonb_agg(row_to_json(rf)), '[]'::jsonb)
    FROM public.read_feedback rf WHERE rf.user_id = p_user_id
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

-- Re-issued from 073 (CREATE OR REPLACE preserves privileges, but these are the
-- guarantee that a future DROP+CREATE cannot quietly widen access):
-- anon must not reach this RPC at all; authenticated may call it but the guard
-- above confines them to their own data; service_role is the legitimate app path.
REVOKE EXECUTE ON FUNCTION public.export_user_data(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.export_user_data(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.export_user_data(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.export_user_data(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. GDPR — delete_user_account(uuid)
-- ---------------------------------------------------------------------------
-- Body copied from 082_memory_files.sql (the current latest definition), with
-- read_feedback deleted explicitly. It cascades via its user_id FK, but this
-- function's established contract is to list every table explicitly and return
-- per-table row counts — follow it. read_feedback must be deleted BEFORE
-- messages/conversations: it FKs to both with ON DELETE CASCADE, so deleting
-- them first would silently zero its count.
--
-- This function carries no explicit GRANT/REVOKE anywhere in the repo; it is
-- protected by its in-function guard. CREATE OR REPLACE leaves its existing
-- privileges untouched, so none are re-issued here.
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

  -- Added in 083. Must precede messages/conversations — read_feedback FKs to
  -- both ON DELETE CASCADE, so deleting those first would zero this count.
  delete from public.read_feedback where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('read_feedback', cnt);

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

  -- Added in 082 — the filing cabinet. Revisions first (FK to memory_files).
  delete from public.memory_file_revisions where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('memory_file_revisions', cnt);

  delete from public.memory_files where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('memory_files', cnt);

  delete from public.consent_records where user_id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('consent_records', cnt);

  delete from public.user_profiles where id = p_user_id;
  get diagnostics cnt = row_count;
  deleted_counts := deleted_counts || jsonb_build_object('user_profiles', cnt);

  return deleted_counts;
end;
$function$;
