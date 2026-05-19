-- 045_rename_trips_to_events.sql
--
-- v2.5: rename trips → events, add kind column. All existing rows are
-- backfilled to kind = 'travel'. Foreign keys on transactions update.
--
-- Apply to staging (qlbhvlssksnrhsleadzn) via Supabase MCP.
-- Production: Lewis applies via prod-backfill-v2.5.sql, NOT this file.

-- 1. Rename table
ALTER TABLE public.trips RENAME TO events;

-- 2. Add kind column with default
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'travel'
    CHECK (kind IN ('travel', 'celebration', 'gift', 'other'));

-- 3. Backfill (defaults handle it but explicit for clarity)
UPDATE public.events SET kind = 'travel' WHERE kind IS NULL;

-- 4. Rename transactions.trip_id → event_id, update FK
ALTER TABLE public.transactions RENAME COLUMN trip_id TO event_id;
ALTER TABLE public.transactions
  DROP CONSTRAINT IF EXISTS transactions_trip_id_fkey;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_event_id_fkey
  FOREIGN KEY (event_id) REFERENCES public.events(id)
  ON DELETE SET NULL;

-- 5. Rename transactions.trip_name → event_name for symmetry
ALTER TABLE public.transactions RENAME COLUMN trip_name TO event_name;

-- 6. Rename indexes (trips_* → events_*) so naming stays self-documenting
ALTER INDEX IF EXISTS trips_pkey RENAME TO events_pkey;
ALTER INDEX IF EXISTS idx_trips_dates RENAME TO idx_events_dates;
ALTER INDEX IF EXISTS idx_trips_user_id RENAME TO idx_events_user_id;
ALTER INDEX IF EXISTS idx_trips_user_status RENAME TO idx_events_user_status;
ALTER INDEX IF EXISTS idx_trips_conversation RENAME TO idx_events_conversation;
ALTER INDEX IF EXISTS idx_trips_goal RENAME TO idx_events_goal;

-- 7. Rename RLS policies (trips_*_own → events_*_own)
ALTER POLICY trips_select_own ON public.events RENAME TO events_select_own;
ALTER POLICY trips_insert_own ON public.events RENAME TO events_insert_own;
ALTER POLICY trips_update_own ON public.events RENAME TO events_update_own;
ALTER POLICY trips_delete_own ON public.events RENAME TO events_delete_own;

COMMENT ON TABLE public.events IS
  'Time-bound spending occasions: travel, celebrations, gifts, other. Renamed from trips in v2.5.';
COMMENT ON COLUMN public.events.kind IS
  'Type of event. travel = trips; celebration = weddings/birthdays; gift = giving occasions; other = catch-all.';
