-- PROD BACKFILL — DO NOT auto-apply.
--
-- This file mirrors 068_benchmark_reference.sql. It is applied by hand to
-- the production Supabase project (iccelmjenljanqrhhzdv) by Lewis before
-- the bill-benchmark-reference branch is merged. Staging
-- (qlbhvlssksnrhsleadzn) gets the migration via the normal apply_migration
-- path.

CREATE TYPE public.bill_subtype AS ENUM (
  'broadband',
  'mobile',
  'electricity',
  'gas',
  'home_insurance',
  'auto_insurance',
  'streaming_subscription'
);

ALTER TABLE public.recurring_expenses
  ADD COLUMN bill_subtype public.bill_subtype;

ALTER TABLE public.user_declared_fixed_costs
  ADD COLUMN bill_subtype public.bill_subtype;

CREATE TABLE public.benchmark_reference (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country      TEXT NOT NULL CHECK (country IN ('GB', 'ES')),
  bill_subtype public.bill_subtype NOT NULL,
  band_low     NUMERIC,
  band_high    NUMERIC,
  currency     TEXT NOT NULL CHECK (currency IN ('GBP', 'EUR')),
  basis        TEXT NOT NULL,
  source       TEXT NOT NULL,
  source_url   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (country, bill_subtype),
  CHECK (
    (band_low IS NULL AND band_high IS NULL)
    OR (band_low IS NOT NULL AND band_high IS NOT NULL AND band_low <= band_high)
  )
);

CREATE INDEX benchmark_reference_country_subtype_idx
  ON public.benchmark_reference (country, bill_subtype);

ALTER TABLE public.benchmark_reference ENABLE ROW LEVEL SECURITY;

CREATE POLICY benchmark_reference_select
  ON public.benchmark_reference
  FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL);

INSERT INTO public.benchmark_reference (country, bill_subtype, band_low, band_high, currency, basis, source) VALUES
  ('GB', 'broadband',              NULL, NULL, 'GBP', 'single household, latest annual data', 'TODO: Ofcom Pricing Trends'),
  ('GB', 'mobile',                  NULL, NULL, 'GBP', 'single SIM, latest annual data',       'TODO: Ofcom Pricing Trends'),
  ('GB', 'electricity',             NULL, NULL, 'GBP', 'single household, dual fuel split',    'TODO: Ofgem default tariff cap + ONS LCFS'),
  ('GB', 'gas',                     NULL, NULL, 'GBP', 'single household, dual fuel split',    'TODO: Ofgem default tariff cap + ONS LCFS'),
  ('GB', 'home_insurance',          NULL, NULL, 'GBP', 'standard contents+buildings, latest',  'TODO: ABI Home Insurance Premium Tracker'),
  ('GB', 'auto_insurance',          NULL, NULL, 'GBP', 'comprehensive, latest annual',         'TODO: ABI Motor Insurance Premium Tracker'),
  ('GB', 'streaming_subscription',  NULL, NULL, 'GBP', 'standard-tier retail price band',      'TODO: published retail price list (Netflix / Spotify / Disney+ standard tiers)'),
  ('ES', 'broadband',              NULL, NULL, 'EUR', 'single household, latest annual data', 'TODO: CNMC sector report (telecoms)'),
  ('ES', 'mobile',                  NULL, NULL, 'EUR', 'single SIM, latest annual data',       'TODO: CNMC sector report (telecoms)'),
  ('ES', 'electricity',             NULL, NULL, 'EUR', 'single household, regulated tariff',   'TODO: CNMC / IDAE household energy report'),
  ('ES', 'gas',                     NULL, NULL, 'EUR', 'single household, regulated tariff',   'TODO: CNMC / IDAE household energy report'),
  ('ES', 'home_insurance',          NULL, NULL, 'EUR', 'standard multi-risk hogar, latest',    'TODO: UNESPA / ICEA insurance sector report'),
  ('ES', 'auto_insurance',          NULL, NULL, 'EUR', 'standard motor, latest annual',        'TODO: UNESPA / ICEA insurance sector report'),
  ('ES', 'streaming_subscription',  NULL, NULL, 'EUR', 'standard-tier retail price band',      'TODO: published retail price list (Netflix / Spotify / Disney+ standard tiers)');
