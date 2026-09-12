-- 085_memory_files_digest_cursor.sql
--
-- One column: memory_files.digest_cursor.
--
-- WHY. Once a user edits a digest file, `user_edited_at` freezes it and the
-- system may only append. To decide WHAT to append, src/lib/memory/digests.ts
-- asked "which traits landed since this file was last touched?" and used the
-- file's own `updated_at` as the cutoff.
--
-- That is wrong, because `updated_at` is maintained by the canonical trigger
-- (see 082) and therefore moves on EVERY write — including the system's own
-- appends. Two failures follow:
--
--   * SKIP. A trait dismissal appends a "Struck out" line without filing the
--     pending delta, which pushes `updated_at` forward. Any trait that landed
--     between the user's edit and that dismissal now sits below the cutoff and
--     is never filed at all.
--   * DUPLICATE. The trait filter reads `updated_at ?? created_at`, so a
--     re-extracted trait re-appears under a second "Since you edited this"
--     header.
--
-- `digest_cursor` separates the two questions. It is the high-water mark of
-- TRAIT timestamps the digest has actually filed, advanced only when trait
-- lines are appended — never by a dismissal, never by a user edit. NULL means
-- "nothing filed since the freeze", and the data layer falls back to
-- `user_edited_at`.
--
-- Additive only: one nullable column, no backfill, no constraint, no index
-- (it is only ever read by id, on a row already being fetched).
--
-- SAFE IN EITHER ORDER relative to the code deploy. The column is deliberately
-- NOT added to `FULL_COLUMNS` in src/lib/memory/files.ts, because Postgrest
-- fails an entire select on one unknown column and `getFile` backs the chat
-- tools, the office UI and the Read-filing path — coupling them to this
-- migration would turn a lagging prod apply into an outage. The cursor has its
-- own small accessors which fail soft: if the column is absent they log and
-- return null, and the digest falls back to `user_edited_at`, which is exactly
-- the pre-085 behaviour minus the skip.
--
-- GDPR: no RPC change needed. `export_user_data` selects `row_to_json(mf)` over
-- memory_files, so the new column is exported automatically, and
-- `delete_user_account` deletes whole rows. Deliberately NOT touching either
-- function — see the clobber hazard note at the top of 082.
--
-- Applied to staging (qlbhvlssksnrhsleadzn) by the normal apply path. Lewis
-- applies to production (iccelmjenljanqrhhzdv) by hand via the identical twin
-- prod-backfill-085_memory_files_digest_cursor.sql.

ALTER TABLE public.memory_files
  ADD COLUMN IF NOT EXISTS digest_cursor TIMESTAMPTZ;

COMMENT ON COLUMN public.memory_files.digest_cursor IS
  'High-water mark of financial_portrait trait timestamps this file has already filed, for frozen (user_edited_at IS NOT NULL) digests. Advanced ONLY when trait lines are appended — never by a dismissal or a user edit. NULL falls back to user_edited_at. Maintained by src/lib/memory/digests.ts.';
