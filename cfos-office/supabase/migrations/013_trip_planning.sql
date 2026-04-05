-- ============================================================
-- 013 — Trip Planning: extend trips table with budget,
--       funding plan, goal linkage, and research data
-- ============================================================

-- New columns on the existing trips table
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS destination         text,
  ADD COLUMN IF NOT EXISTS duration_days       integer,
  ADD COLUMN IF NOT EXISTS travel_style        text,            -- 'budget', 'mid-range', 'luxury'
  ADD COLUMN IF NOT EXISTS companions          text,            -- 'solo', 'partner', 'family', 'friends', 'group'
  ADD COLUMN IF NOT EXISTS companion_count     integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS estimated_budget    jsonb,           -- { flights, accommodation, food, activities, local_transport, misc }
  ADD COLUMN IF NOT EXISTS total_estimated     numeric,
  ADD COLUMN IF NOT EXISTS total_actual        numeric,         -- computed after trip from linked transactions
  ADD COLUMN IF NOT EXISTS funding_plan        jsonb,           -- { monthly_saving, months_to_save, feasibility, suggested_cuts }
  ADD COLUMN IF NOT EXISTS goal_id             uuid REFERENCES public.goals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conversation_id     uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS research_data       jsonb,           -- cached flight/hotel research from web search
  ADD COLUMN IF NOT EXISTS status              text DEFAULT 'planning',  -- planning, booked, in_progress, completed, cancelled
  ADD COLUMN IF NOT EXISTS currency            text DEFAULT 'EUR';

COMMENT ON COLUMN public.trips.estimated_budget IS 'Category-level budget breakdown: flights, accommodation, food, activities, local_transport, misc.';
COMMENT ON COLUMN public.trips.funding_plan     IS 'How to fund the trip: monthly saving amount, months needed, feasibility rating, suggested cuts.';
COMMENT ON COLUMN public.trips.research_data    IS 'Cached web search results: flight prices, hotel ranges, daily cost estimates.';
COMMENT ON COLUMN public.trips.status           IS 'Trip lifecycle: planning → booked → in_progress → completed / cancelled.';

-- Index for querying active trips
CREATE INDEX IF NOT EXISTS idx_trips_user_status
  ON public.trips(user_id, status);

-- RLS policies already exist from 003_category_system.sql — no changes needed.

-- ============================================================
-- Rollback (commented out for safety)
-- ============================================================
-- ALTER TABLE public.trips
--   DROP COLUMN IF EXISTS destination,
--   DROP COLUMN IF EXISTS duration_days,
--   DROP COLUMN IF EXISTS travel_style,
--   DROP COLUMN IF EXISTS companions,
--   DROP COLUMN IF EXISTS companion_count,
--   DROP COLUMN IF EXISTS estimated_budget,
--   DROP COLUMN IF EXISTS total_estimated,
--   DROP COLUMN IF EXISTS total_actual,
--   DROP COLUMN IF EXISTS funding_plan,
--   DROP COLUMN IF EXISTS goal_id,
--   DROP COLUMN IF EXISTS conversation_id,
--   DROP COLUMN IF EXISTS research_data,
--   DROP COLUMN IF EXISTS status,
--   DROP COLUMN IF EXISTS currency;
-- DROP INDEX IF EXISTS idx_trips_user_status;
