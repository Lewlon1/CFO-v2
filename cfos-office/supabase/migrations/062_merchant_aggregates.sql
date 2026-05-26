-- Session 32 (A) — Behavioural engine source layer
-- Monthly per-user per-merchant aggregates for the cluster-behaviour derivation library
-- Refresh: nightly via pg_cron + manual RPC after CSV imports

-- Enable pg_cron (no-op if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.merchant_aggregates AS
SELECT
  user_id,
  description AS merchant_key,
  date_trunc('month', date)::DATE AS month_start,
  COUNT(*) AS transaction_count,
  SUM(amount)::NUMERIC AS total_amount,
  AVG(amount)::NUMERIC AS mean_amount,
  COALESCE(STDDEV(amount), 0)::NUMERIC AS stddev_amount,
  MIN(date)::DATE AS first_seen,
  MAX(date)::DATE AS last_seen,
  ARRAY_AGG(EXTRACT(DOW FROM date)::INTEGER ORDER BY date) AS dow_array,
  mode() WITHIN GROUP (ORDER BY category_id) AS dominant_category_id
FROM public.transactions
WHERE deleted_at IS NULL
  AND description IS NOT NULL
GROUP BY user_id, description, month_start;

-- Unique index required for REFRESH CONCURRENTLY
CREATE UNIQUE INDEX merchant_aggregates_unique
  ON public.merchant_aggregates(user_id, merchant_key, month_start);

-- Query indexes for the access patterns (per-merchant lookup, per-category rollup)
CREATE INDEX merchant_aggregates_user_merchant
  ON public.merchant_aggregates(user_id, merchant_key);
CREATE INDEX merchant_aggregates_user_category
  ON public.merchant_aggregates(user_id, dominant_category_id);

-- Materialized views don't support RLS; service-role-only read.
-- All consumer code must filter by user_id (enforced in queries.ts).
-- Explicitly revoke from PUBLIC, anon, AND authenticated — PostgREST exposes
-- materialized views to anon/authenticated by default if not locked down.
REVOKE ALL ON public.merchant_aggregates FROM PUBLIC;
REVOKE ALL ON public.merchant_aggregates FROM anon;
REVOKE ALL ON public.merchant_aggregates FROM authenticated;
GRANT SELECT ON public.merchant_aggregates TO service_role;

-- Manual refresh RPC (callable from app after CSV imports)
CREATE OR REPLACE FUNCTION public.refresh_merchant_aggregates()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.merchant_aggregates;
END;
$$;

-- Lock down the refresh RPC: only service_role (CSV import path, cron) can call.
REVOKE EXECUTE ON FUNCTION public.refresh_merchant_aggregates() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_merchant_aggregates() FROM anon;
REVOKE EXECUTE ON FUNCTION public.refresh_merchant_aggregates() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_merchant_aggregates() TO service_role;

-- Nightly scheduled refresh via pg_cron
SELECT cron.schedule(
  'refresh-merchant-aggregates-nightly',
  '0 3 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.merchant_aggregates$$
);

COMMENT ON MATERIALIZED VIEW public.merchant_aggregates IS
  'Monthly per-user per-merchant aggregates. Source for Layer 3 behavioural feature derivation (cluster-behaviour library). Service-role read only.';
