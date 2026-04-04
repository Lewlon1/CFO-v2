-- profiling_queue: tracks which profile fields have been asked/answered/dismissed
CREATE TABLE IF NOT EXISTS public.profiling_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  field text NOT NULL,
  status text DEFAULT 'pending',  -- pending | asked | answered | dismissed
  asked_at timestamptz,
  answered_at timestamptz,
  source text,  -- structured_input | conversation | inferred
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, field)
);

ALTER TABLE profiling_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiling_queue_select" ON profiling_queue FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "profiling_queue_insert" ON profiling_queue FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "profiling_queue_update" ON profiling_queue FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX idx_profiling_queue_user_status ON profiling_queue(user_id, status);

-- Add dismissed_at to financial_portrait for soft-delete of traits
ALTER TABLE financial_portrait ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;
