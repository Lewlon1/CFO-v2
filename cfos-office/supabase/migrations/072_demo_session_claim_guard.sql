-- One-time claim guard for demo (Value Map) session linking.
--
-- Background: /api/value-map/link-session lets an authenticated account copy an
-- anonymous demo session (its quadrant responses + seeded value rules) into the
-- account, looking the session up by its `session_token`. Without a claim guard
-- any account that learns a token can ingest another visitor's Value Map.
--
-- These columns let the route claim a session atomically: the first account to
-- link a given token wins, and a second account cannot re-claim it.

alter table public.demo_sessions
  add column if not exists claimed_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists claimed_at timestamptz;

create index if not exists idx_demo_sessions_claimed_by
  on public.demo_sessions (claimed_by_user_id);
