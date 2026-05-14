-- 042_llm_usage_log_tool_calls.sql
-- Adds tool_name column to llm_usage_log so chat tool invocations can be
-- attributed individually. call_type already exists; we reuse it with the
-- new value 'tool_call' written by lib/observability/llm-usage-log.ts.
-- A filtered call_type='tool_call' index is intentionally omitted because the
-- existing idx_llm_usage_type covers (call_type, created_at DESC).

ALTER TABLE llm_usage_log
  ADD COLUMN IF NOT EXISTS tool_name text;

CREATE INDEX IF NOT EXISTS idx_llm_usage_log_tool_name
  ON llm_usage_log (tool_name, created_at DESC)
  WHERE tool_name IS NOT NULL;
