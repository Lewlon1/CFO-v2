-- Bill benchmark reference — observational peer-comparison layer.
--
-- Lights up the `flagAgainstBenchmark()` integration left by the value-first
-- onboarding session. The pipeline emits one observational verdict per fixed
-- cost ("at £45 sits above the typical UK range of £25–35"). It is the only
-- place "above average" claims appear in the product.
--
-- Discipline encoded in the schema:
--   - Band, never a point — band_low / band_high are separate columns.
--   - Source or silence — `source NOT NULL`; rows with NULL bands are treated
--     as "not available" by the flagger (returns null verdict).
--   - Contractual / fixed categories only — the `bill_subtype` enum is the
--     allowlist. Lifestyle-variable spend (groceries, dining, transport)
--     can't be encoded into a benchmark row because the type system rejects
--     it.
--
-- Sub-type discrimination lives on the bills themselves (new bill_subtype
-- columns on recurring_expenses and user_declared_fixed_costs). The
-- recurring detector runs a keyword classifier to populate the column on
-- detection; declared bills are classified on-the-fly during reconcile.

-- ─── 1. The bill_subtype enum ────────────────────────────────────────────
-- Constrained set. Future additions need a migration, not a runtime config —
-- the flagger refuses subtypes outside the enum (the type system enforces).

CREATE TYPE public.bill_subtype AS ENUM (
  'broadband',
  'mobile',
  'electricity',
  'gas',
  'home_insurance',
  'auto_insurance',
  'streaming_subscription'
);

-- ─── 2. bill_subtype columns on existing bill tables ─────────────────────

ALTER TABLE public.recurring_expenses
  ADD COLUMN bill_subtype public.bill_subtype;

ALTER TABLE public.user_declared_fixed_costs
  ADD COLUMN bill_subtype public.bill_subtype;

-- Both columns nullable forever — NULL means "no benchmark eligible", which
-- is the safe default. No indexes: the column is queried only inside the
-- reconcile/flag path against the per-user row already in memory.

-- ─── 3. benchmark_reference table ────────────────────────────────────────

CREATE TABLE public.benchmark_reference (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country      TEXT NOT NULL CHECK (country IN ('GB', 'ES')),
  bill_subtype public.bill_subtype NOT NULL,
  -- Monthly equivalents, currency-native. NULL when the band has not yet
  -- been sourced — the flagger silences itself on any row with either
  -- bound NULL.
  band_low     NUMERIC,
  band_high    NUMERIC,
  currency     TEXT NOT NULL CHECK (currency IN ('GBP', 'EUR')),
  -- Short text describing what the band represents, e.g. "single household,
  -- 2025" or "median + IQR, ofcom 2025".
  basis        TEXT NOT NULL,
  -- Citation REQUIRED — no row exists without one. 'TODO: <regulator>' is
  -- allowed during sourcing; the flagger checks bands not source, so unsourced
  -- rows stay silent without code-level allowlisting.
  source       TEXT NOT NULL,
  source_url   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One row per (country, bill_subtype). National granularity at Wave 2 —
  -- regional / city segmentation is a future column behind the same key.
  UNIQUE (country, bill_subtype),
  -- Bands must be coherent when both populated.
  CHECK (
    (band_low IS NULL AND band_high IS NULL)
    OR (band_low IS NOT NULL AND band_high IS NOT NULL AND band_low <= band_high)
  )
);

CREATE INDEX benchmark_reference_country_subtype_idx
  ON public.benchmark_reference (country, bill_subtype);

ALTER TABLE public.benchmark_reference ENABLE ROW LEVEL SECURITY;

-- Read-only reference data — every authenticated session can SELECT. No
-- insert / update / delete policies: writes go through migrations only
-- (service role bypasses RLS). Matches the locked-down pattern used for
-- merchant_aggregates.
CREATE POLICY benchmark_reference_select
  ON public.benchmark_reference
  FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL);

COMMENT ON TABLE public.benchmark_reference IS
  'Public benchmark bands for contractual / fixed-cost categories, keyed by (country, bill_subtype). Read-only reference; rows with NULL bands silence the flagger by design.';

-- ─── 4. Structural seed rows (no bands populated) ────────────────────────
--
-- Every (country, bill_subtype) pair benchmarkable at Wave 2. Bands left
-- NULL so the flagger stays silent until Lewis populates real numbers from
-- the sources enumerated in docs/benchmark-bands-needed.md. The source
-- string carries a TODO marker pointing at the recommended regulator /
-- public dataset.

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
