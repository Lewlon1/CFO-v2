-- Adds public.import_attempts — append-only telemetry for statement import
-- attempts. The PDF vision route (/api/extract-pdf-transactions) writes one
-- row per upload after extraction completes, capturing how many pages were
-- attempted, how many succeeded, which pages failed, and the overall status.
-- Before this table, a timed-out or partial extraction left no DB trace, so
-- failed uploads were invisible. See src/app/api/extract-pdf-transactions/route.ts.
--
-- Apply to staging (qlbhvlssksnrhsleadzn) via the normal apply_migration path.
-- Prod (iccelmjenljanqrhhzdv) gets the companion prod-backfill-074, run by hand.
-- Idempotent via `if not exists` / `drop policy if exists`.

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

-- Read-own only, mirroring persona_sanitiser_log (059). Writes go through the
-- service client in the route, which bypasses RLS; users never insert directly.
drop policy if exists "users read own import attempts" on public.import_attempts;
create policy "users read own import attempts"
  on public.import_attempts for select
  using ((select auth.uid()) = user_id);

create index if not exists import_attempts_user_created_idx
  on public.import_attempts (user_id, created_at desc);

comment on table public.import_attempts is
  'Append-only log of statement import attempts. One row per upload, written by the PDF vision route after extraction. Captures page counts, failed pages, and status so partial/timeout failures are visible. See src/app/api/extract-pdf-transactions/route.ts.';
