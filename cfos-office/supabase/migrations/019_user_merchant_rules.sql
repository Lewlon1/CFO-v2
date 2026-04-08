-- ============================================================
-- The CFO's Office — User Merchant Rules Migration
-- File: 019_user_merchant_rules.sql
--
-- Stores learned traditional category mappings from user
-- corrections. When a user corrects a transaction's category
-- and checks "apply to similar", the normalised merchant name
-- is mapped to the corrected category_id for future imports.
-- ============================================================

create table if not exists public.user_merchant_rules (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null references public.user_profiles(id) on delete cascade,
  normalised_merchant text        not null,
  category_id         text        not null references public.categories(id) on update cascade on delete cascade,
  confidence          numeric     not null default 0.95,
  source              text        not null default 'user_correction',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint user_merchant_rules_unique unique (user_id, normalised_merchant)
);

comment on table  public.user_merchant_rules                    is 'Per-user learned category rules from transaction corrections.';
comment on column public.user_merchant_rules.normalised_merchant is 'Output of normaliseMerchant() — lowercased, stripped of prefixes/suffixes.';
comment on column public.user_merchant_rules.source              is 'How this rule was created: user_correction, bulk_import, etc.';


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.user_merchant_rules enable row level security;

create policy "umr_select_own"
  on public.user_merchant_rules for select
  to authenticated
  using (user_id = auth.uid());

create policy "umr_insert_own"
  on public.user_merchant_rules for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "umr_update_own"
  on public.user_merchant_rules for update
  to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "umr_delete_own"
  on public.user_merchant_rules for delete
  to authenticated
  using (user_id = auth.uid());


-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_umr_user
  on public.user_merchant_rules(user_id);


-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

drop trigger if exists user_merchant_rules_updated_at on public.user_merchant_rules;
create trigger user_merchant_rules_updated_at
  before update on public.user_merchant_rules
  for each row execute function public.handle_updated_at();
