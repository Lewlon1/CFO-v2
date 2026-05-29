-- prod-backfill — Session 32 (A) — merchant_aggregates materialized view
-- DO NOT auto-apply. Lewis runs this manually against the production project
-- (iccelmjenljanqrhhzdv) after a final review during the eventual session-32 merge.
--
-- Equivalent to staging migration 062_merchant_aggregates.sql.

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

CREATE UNIQUE INDEX merchant_aggregates_unique
  ON public.merchant_aggregates(user_id, merchant_key, month_start);

CREATE INDEX merchant_aggregates_user_merchant
  ON public.merchant_aggregates(user_id, merchant_key);
CREATE INDEX merchant_aggregates_user_category
  ON public.merchant_aggregates(user_id, dominant_category_id);

REVOKE ALL ON public.merchant_aggregates FROM PUBLIC;
REVOKE ALL ON public.merchant_aggregates FROM anon;
REVOKE ALL ON public.merchant_aggregates FROM authenticated;
GRANT SELECT ON public.merchant_aggregates TO service_role;

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

REVOKE EXECUTE ON FUNCTION public.refresh_merchant_aggregates() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_merchant_aggregates() FROM anon;
REVOKE EXECUTE ON FUNCTION public.refresh_merchant_aggregates() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_merchant_aggregates() TO service_role;

SELECT cron.schedule(
  'refresh-merchant-aggregates-nightly',
  '0 3 * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.merchant_aggregates$$
);

COMMENT ON MATERIALIZED VIEW public.merchant_aggregates IS
  'Monthly per-user per-merchant aggregates. Source for Layer 3 behavioural feature derivation (cluster-behaviour library). Service-role read only.';
