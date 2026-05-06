-- 036_bank_format_templates.sql
--
-- Cache of auto-detected file-format templates used by the universal
-- statement parser (Session A). Keyed by a SHA-256 fingerprint of the
-- sorted, lowercased column headers so the same Revolut export is
-- recognised across users without another LLM call. Templates are
-- shared globally (no user_id partitioning) — the first user to upload
-- a new format pays the one-off Haiku detection cost; every subsequent
-- upload is zero-LLM.

create table if not exists public.bank_format_templates (
  id                  uuid        primary key default gen_random_uuid(),
  header_hash         text        not null unique,
  bank_name           text,
  file_type           text        not null
    check (file_type in ('csv', 'pdf', 'ofx', 'qif')),
  column_mapping      jsonb       not null,
  sign_convention     text        not null
    check (sign_convention in ('signed_single_column', 'split_in_out', 'type_flag')),
  date_format         text        not null,
  decimal_format      text        not null
    check (decimal_format in ('dot', 'comma')),
  currency_default    text        not null default 'GBP',
  sample_headers      text        not null,
  detection_source    text        not null default 'llm'
    check (detection_source in ('llm', 'manual', 'user_confirmed')),
  created_by_user_id  uuid        references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  use_count           integer     not null default 1
);

create index if not exists idx_bank_format_templates_hash
  on public.bank_format_templates(header_hash);

alter table public.bank_format_templates enable row level security;

-- Any authenticated user can read templates (they are shared cache, not
-- user data). Writes happen only via the service-role client inside
-- /api/detect-format, so no insert/update policy is needed.
drop policy if exists "authenticated read bank_format_templates"
  on public.bank_format_templates;
create policy "authenticated read bank_format_templates"
  on public.bank_format_templates for select
  to authenticated using (true);

comment on table public.bank_format_templates is
  'Auto-detected file format templates keyed by header fingerprint. Shared globally across users so any bank format becomes zero-config after the first upload.';
comment on column public.bank_format_templates.sign_convention is
  'signed_single_column = amount column is pre-signed (debits negative); split_in_out = separate credit/debit columns, both positive; type_flag = sign derived from a type column (e.g. DR/CR).';
comment on column public.bank_format_templates.decimal_format is
  'dot = 1,234.56 (comma thousands, dot decimal — UK/US); comma = 1.234,56 (dot thousands, comma decimal — ES/DE/FR).';
comment on column public.bank_format_templates.use_count is
  'Incremented on every cache hit. High counts = high-confidence templates.';
