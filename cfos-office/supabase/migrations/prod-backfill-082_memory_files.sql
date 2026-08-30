-- prod-backfill-082_memory_files.sql
--
-- ⚠️ PRODUCTION-ONLY, MANUAL. Lewis runs this by hand against
-- iccelmjenljanqrhhzdv. It is NOT applied by automation. Staging
-- (qlbhvlssksnrhsleadzn) gets the change via the normal apply path from
-- 082_memory_files.sql, which this file mirrors exactly.
--
-- The Filing Cabinet — creates public.memory_files + public.memory_file_revisions
-- (per-user markdown memory the CFO reads/writes via tools and the user edits in
-- the office UI), and teaches the two GDPR RPCs about them.
--
-- Additive for the tables; no data backfill (every existing user simply starts
-- with an empty cabinet). Safe to run before the application code ships —
-- nothing reads or writes these tables until the memory tools land.
--
-- ⚠️ CLOBBER HAZARD — THE GDPR RPCs. This file CREATE OR REPLACEs
-- public.export_user_data(uuid) and public.delete_user_account(uuid). Both are
-- SECURITY DEFINER and take a user id as an argument; export_user_data's
-- authorization guard has already been silently dropped once by a CREATE OR
-- REPLACE that omitted it (a full RLS bypass — see
-- prod-backfill-073_secure_export_user_data.sql and
-- prod-backfill-077_lockdown_user_data_rpcs.sql). The bodies below are the
-- current latest repo definitions (export_user_data from 073,
-- delete_user_account from 070) plus the two new tables, and preserve the
-- in-function guard, SET search_path TO 'public', and export_user_data's
-- REVOKE/GRANT lock-down verbatim.
--
-- BEFORE RUNNING, confirm prod is already at the hardened baseline — this should
-- return a body containing "unauthorized: caller does not match p_user_id":
--   SELECT prosrc FROM pg_proc WHERE proname = 'export_user_data';
-- AFTER RUNNING, re-check the same query, and confirm anon still cannot execute:
--   SELECT has_function_privilege('anon', 'public.export_user_data(uuid)', 'EXECUTE');
--   -- expect: false

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
-- Folder keys match src/lib/tokens.ts `folderColors` (goals|cashflow|values|
-- networth), NOT the office route segments (goals|cash-flow|values|net-worth).
-- src/lib/memory/constants.ts maps between the two.
CREATE TYPE memory_folder AS ENUM ('goals', 'cashflow', 'values', 'networth');

-- Who wrote a given version: the CFO (chat tools), the system (scheduled
-- digests), or the user (office UI editor).
CREATE TYPE memory_actor AS ENUM ('cfo', 'system', 'user');

-- ---------------------------------------------------------------------------
-- 2. memory_files
-- ---------------------------------------------------------------------------
CREATE TABLE public.memory_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  folder memory_folder NOT NULL,
  slug TEXT NOT NULL CHECK (
    slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 1 AND 64
  ),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  -- The one-line index hook: this is what the CFO sees in the prompt, so it has
  -- to earn a retrieval on its own.
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 1 AND 140),
  -- ~2k tokens. Hard ceiling: an oversized file defeats the point of the index.
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 8000),
  source memory_actor NOT NULL DEFAULT 'cfo',
  updated_by memory_actor NOT NULL DEFAULT 'cfo',
  user_edited_at TIMESTAMPTZ,
  pinned BOOLEAN NOT NULL DEFAULT false,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, folder, slug)
);

-- The index/list query: every active file for a user, one folder at a time (or
-- all four in one sweep for the prompt index).
CREATE INDEX memory_files_user_folder
  ON public.memory_files(user_id, folder)
  WHERE archived_at IS NULL;

-- Canonical updated_at trigger (public.handle_updated_at, migration 004). The
-- data layer therefore never sets updated_at itself — one mechanism, not two.
DROP TRIGGER IF EXISTS memory_files_set_updated_at ON public.memory_files;
CREATE TRIGGER memory_files_set_updated_at
  BEFORE UPDATE ON public.memory_files
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.memory_files ENABLE ROW LEVEL SECURITY;

-- (select auth.uid()) wrapping per the standing auth_rls_initplan rule.
CREATE POLICY memory_files_all_own ON public.memory_files FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

COMMENT ON TABLE public.memory_files IS
  'The Filing Cabinet: per-user markdown memory files the CFO reads/writes via tools and the user edits in the office UI. One row = one file, addressed by (user_id, folder, slug).';
COMMENT ON COLUMN public.memory_files.description IS
  'One-line hook shown in the prompt index (<=140 chars). The CFO decides whether to open the file from this alone.';
COMMENT ON COLUMN public.memory_files.user_edited_at IS
  'Stamped the first time the user edits this file. ONE-WAY: never clear it. Non-null means the user''s words are authoritative — the CFO may append but must not replace (enforced in src/lib/memory/files.ts).';
COMMENT ON COLUMN public.memory_files.archived_at IS
  'Soft archive. Archived files drop out of listings, the prompt index and the per-folder cap, but are retained for export and for the user to restore.';

-- ---------------------------------------------------------------------------
-- 3. memory_file_revisions
-- ---------------------------------------------------------------------------
-- Append-only history of PRE-change snapshots. Written immediately before a
-- destructive overwrite, so row N holds the state that overwrite discarded.
-- Pruned to the newest MAX_REVISIONS_PER_FILE (10) per file by the data layer.
CREATE TABLE public.memory_file_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES public.memory_files(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  content TEXT NOT NULL,
  superseded_by memory_actor NOT NULL DEFAULT 'cfo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX memory_file_revisions_file_created
  ON public.memory_file_revisions(file_id, created_at DESC);

ALTER TABLE public.memory_file_revisions ENABLE ROW LEVEL SECURITY;

-- SELECT + INSERT + DELETE, no UPDATE: history is immutable once written — a
-- snapshot can be dropped but never rewritten.
--
-- The DELETE policy is load-bearing, not convenience: src/lib/memory/files.ts
-- prunes each file's history to MAX_REVISIONS_PER_FILE after every overwrite,
-- and it runs under the *user's* client from the chat tools. Without an own-row
-- DELETE policy that prune silently matches zero rows and the table grows
-- without bound.
CREATE POLICY memory_file_revisions_select_own ON public.memory_file_revisions FOR SELECT
  USING ((select auth.uid()) = user_id);
CREATE POLICY memory_file_revisions_insert_own ON public.memory_file_revisions FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);
CREATE POLICY memory_file_revisions_delete_own ON public.memory_file_revisions FOR DELETE
  USING ((select auth.uid()) = user_id);

COMMENT ON TABLE public.memory_file_revisions IS
  'Append-only PRE-change snapshots of memory_files rows, written before a CFO/system overwrite so replaced prose is never lost. Pruned to the newest 10 per file.';
COMMENT ON COLUMN public.memory_file_revisions.superseded_by IS
  'The actor whose write discarded this snapshot.';

-- ---------------------------------------------------------------------------
-- 4. GDPR — export_user_data(uuid)
-- ---------------------------------------------------------------------------
-- Body copied from 073_secure_export_user_data.sql (the current latest
-- definition), with memory_files + memory_file_revisions added. The
-- authorization guard, SET search_path and the REVOKE/GRANT lock-down are
-- preserved — see the CLOBBER HAZARD note at the top of this file.
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
-- 5. GDPR — delete_user_account(uuid)
-- ---------------------------------------------------------------------------
-- Body copied from 070_fix_gdpr_functions_drop_trips.sql (the current latest
-- definition), with the two new tables deleted explicitly before user_profiles.
-- Both cascade via their user_id FK, but this function's established contract is
-- to list every table explicitly and return per-table row counts — follow it.
-- Revisions go first (they FK to memory_files).
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
