-- PROD BACKFILL — DO NOT APPLY — Lewis runs prod manually.
--
-- This file mirrors 078_import_attempts.sql exactly. It is applied by hand to
-- the production Supabase project (iccelmjenljanqrhhzdv) by Lewis before any
-- merge of the upload-robustness branch to main. Staging
-- (qlbhvlssksnrhsleadzn) gets the migration via the normal apply_migration path.

create table if not exists public.import_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  page_count int,
  pages_succeeded int,
  pages_failed int[],
  status text not null,
  error text,
  created_at timestamptz not null default now()
);

alter table public.import_attempts enable row level security;

drop policy if exists "users read own import attempts" on public.import_attempts;
create policy "users read own import attempts"
  on public.import_attempts for select
  using ((select auth.uid()) = user_id);

create index if not exists import_attempts_user_created_idx
  on public.import_attempts (user_id, created_at desc);

comment on table public.import_attempts is
  'Append-only log of statement import attempts. One row per upload, written by the PDF vision route after extraction. Captures page counts, failed pages, and status so partial/timeout failures are visible. See src/app/api/extract-pdf-transactions/route.ts.';
