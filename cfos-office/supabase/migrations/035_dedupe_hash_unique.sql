-- Enforce per-user uniqueness on dedupe_hash so re-uploading the same statement
-- (or two bank exports covering the same period) cannot insert duplicate rows.
-- Existing rows have NULL dedupe_hash and are excluded from the constraint.
create unique index if not exists transactions_user_dedupe_unique
  on public.transactions (user_id, dedupe_hash)
  where deleted_at is null and dedupe_hash is not null;
