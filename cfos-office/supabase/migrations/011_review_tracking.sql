-- Track which months have been reviewed via monthly review conversations
ALTER TABLE public.monthly_snapshots
  ADD COLUMN IF NOT EXISTS review_conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- Fast lookup of unreviewed months per user
CREATE INDEX IF NOT EXISTS idx_snapshots_unreviewed
  ON public.monthly_snapshots(user_id, month DESC)
  WHERE reviewed_at IS NULL;
