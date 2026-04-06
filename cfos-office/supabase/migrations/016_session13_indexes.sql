-- Session 13: Performance indexes for common query patterns
-- These supplement the indexes already created in migrations 001 and 003.

-- Transactions: filter by import_batch_id (upload pipeline, holiday detector)
CREATE INDEX IF NOT EXISTS idx_txn_import_batch
  ON public.transactions(import_batch_id)
  WHERE import_batch_id IS NOT NULL;

-- Transactions: user + category compound (spending summary tool, dashboard)
CREATE INDEX IF NOT EXISTS idx_txn_user_category
  ON public.transactions(user_id, category_id);

-- Transactions: user + value_category compound (value breakdown tool)
CREATE INDEX IF NOT EXISTS idx_txn_user_value_cat
  ON public.transactions(user_id, value_category);

-- Conversations: user + type (finding post_upload, monthly_review, etc.)
CREATE INDEX IF NOT EXISTS idx_conversations_user_type
  ON public.conversations(user_id, type);

-- Nudges: scheduled delivery queries from cron jobs
CREATE INDEX IF NOT EXISTS idx_nudges_scheduled
  ON public.nudges(scheduled_for)
  WHERE status = 'pending';
