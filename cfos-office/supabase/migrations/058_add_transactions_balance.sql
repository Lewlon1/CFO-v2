-- Adds the `balance`, `location_city`, `location_country` columns to
-- public.transactions. Mirrors a staging-only migration
-- (20260415163510 add_balance_and_location_to_transactions) that was
-- applied to the staging DB directly and never committed to the repo,
-- so prod never picked it up.
--
-- Consequences in prod:
--   • lib/upload/pipeline.ts INSERTs `balance` — Postgres 42703,
--     every row fails, stats.errors++ silently, route returns
--     imported: 0. Every CSV/XLSX/PDF/OFX/QIF upload since 2026-05-01
--     has dropped all rows. The wizard logs upload_completed with
--     transaction_count: 0 as if it succeeded.
--   • lib/analytics/location-enricher.ts queries / updates
--     `location_city` / `location_country` immediately after import —
--     would be the next failure point once `balance` is fixed.
--
-- Downstream consumers (column intent is current, not legacy):
--   • lib/analytics/insight-engine.ts (balance_data, location_data
--     dependency gates)
--   • lib/analytics/pattern-detectors.ts (balance_data + location
--     detectors).

alter table public.transactions
  add column if not exists balance numeric,
  add column if not exists location_city text,
  add column if not exists location_country text;

comment on column public.transactions.balance is
  'Running balance after this transaction, when the source export provides one (Revolut Balance, Santander Saldo). Null when missing/unparseable. Consumed by the balance_trajectory detector.';

comment on column public.transactions.location_city is
  'City inferred by location-enricher from the merchant string. Null until enrichment runs.';

comment on column public.transactions.location_country is
  'ISO country code inferred by location-enricher from the merchant string. Null until enrichment runs.';
