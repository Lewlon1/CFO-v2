-- 074_llm_guard.sql
--
-- LLM cost-guard support (see src/lib/ai/llm-guard.ts): a per-user block flag.
--
-- Context: incident 2026-07-03 (concurrent chat turns) exposed that no
-- server-side mechanism could stop a single account's Bedrock spend. The
-- guard's other layers need no schema (env kill switch, in-memory burst
-- limiter, daily cap counted from llm_usage_log — idx_llm_usage_user
-- (user_id, created_at DESC) already serves that count). The one unavoidable
-- column is the per-user block:
--
--   set:   update user_profiles set llm_blocked_at = now() where id = '<uuid>';
--   clear: update user_profiles set llm_blocked_at = null  where id = '<uuid>';
--
-- While set, every user-triggerable LLM route refuses with the friendly block
-- (no Bedrock call). Computed data stays fully readable — only fresh LLM
-- turns are gated (CLAUDE.md Rule 6).
--
-- Additive-only; no data backfill needed (null = not blocked).

alter table public.user_profiles
  add column if not exists llm_blocked_at timestamptz;

comment on column public.user_profiles.llm_blocked_at is
  'When set, all user-triggerable LLM calls are refused (friendly block, no Bedrock spend). Set/clear manually to stop a runaway or abusive account. Enforced by src/lib/ai/llm-guard.ts.';
