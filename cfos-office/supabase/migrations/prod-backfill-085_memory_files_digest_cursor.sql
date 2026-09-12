-- prod-backfill-085_memory_files_digest_cursor.sql
--
-- ⚠️ PRODUCTION-ONLY, MANUAL. Lewis runs this by hand against
-- iccelmjenljanqrhhzdv. It is NOT applied by automation.
--
-- Identical to staging migration 085: adds one nullable column,
-- memory_files.digest_cursor, so a frozen digest can track which portrait
-- traits it has already filed instead of misusing the file's `updated_at`
-- (which a trigger moves on every write, including the system's own appends).
-- See the header of 085 for the two bugs that motivates.
--
-- Additive-only. No backfill, no constraint, no index, no RPC change.
--
-- SAFE TO RUN AT ANY TIME, IN EITHER ORDER relative to the code deploy:
--   * column present, code not yet shipped → nothing writes it, nothing reads it;
--   * code shipped, column not yet present → the cursor accessors fail soft,
--     log once, and the digest falls back to `user_edited_at`. That is the
--     pre-085 behaviour with the skip bug narrowed, not an outage.
-- This is deliberate: `digest_cursor` is kept OUT of `FULL_COLUMNS` in
-- src/lib/memory/files.ts precisely so that `getFile` — which backs the chat
-- tools, the office UI and Read filing — is never coupled to this migration.
--
-- Prod is NOT expected to have migration 082 lagging; if memory_files does not
-- exist on prod yet, apply prod-backfill-082_memory_files.sql first and this
-- becomes a no-op until then.
--
-- Verify after running:
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name = 'memory_files'
--     and column_name = 'digest_cursor';
--   -- expect exactly one row: digest_cursor | timestamp with time zone | YES

ALTER TABLE public.memory_files
  ADD COLUMN IF NOT EXISTS digest_cursor TIMESTAMPTZ;

COMMENT ON COLUMN public.memory_files.digest_cursor IS
  'High-water mark of financial_portrait trait timestamps this file has already filed, for frozen (user_edited_at IS NOT NULL) digests. Advanced ONLY when trait lines are appended — never by a dismissal or a user edit. NULL falls back to user_edited_at. Maintained by src/lib/memory/digests.ts.';
