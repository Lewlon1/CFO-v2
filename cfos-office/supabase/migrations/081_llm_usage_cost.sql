-- 081_llm_usage_cost.sql
--
-- Session B1: the cost meter. Adds the per-call cost + cache-token columns to
-- llm_usage_log so every Bedrock completion records its own USD cost at write
-- time (Rule 2 — the system computes, the LLM never estimates). Additive-only.
--
-- Rule 8 (one source of truth): we EXTEND llm_usage_log rather than spawn a
-- parallel bedrock_usage_log — cost is a 1:1 fact per existing usage row, the
-- table already carries the GDPR soft-delete/anonymise columns, and the cost
-- guard already counts it. A second table would split "usage" into two sources
-- and force a join for every cost sum.
--
-- Cost is written by the service role only (track-llm-usage.ts trackLLMUsage
-- for non-chat surfaces; llm-guard.ts completeChatTurn for the chat turn). The
-- rate table lives in src/lib/ai/rates.ts (RATE_VERSION stamped per row).

begin;

alter table public.llm_usage_log
  add column if not exists computed_cost_usd numeric(10, 6),
  add column if not exists cache_read_tokens integer,
  add column if not exists cache_write_tokens integer,
  add column if not exists rate_version text;

comment on column public.llm_usage_log.computed_cost_usd is
  'USD cost of this completion, computed at write time from src/lib/ai/rates.ts (Rule 2). Null = cost unknown (unpriced/misconfigured model) — never silently zeroed.';
comment on column public.llm_usage_log.cache_read_tokens is
  'Prompt-cache read tokens (billed ~0.1x input). A non-zero value on a second chat turn within the cache TTL is the proof the Phase-2 cache seam is working.';
comment on column public.llm_usage_log.cache_write_tokens is
  'Prompt-cache write tokens (billed ~1.25x input at the 5-minute TTL).';
comment on column public.llm_usage_log.rate_version is
  'The rates.ts RATE_VERSION used to compute computed_cost_usd (null when cost is null).';

-- G4 — cost/rate columns are service-role/admin-only. The authenticated and
-- anon roles hold a blanket table-level SELECT grant (Supabase default), which
-- would otherwise cover the new columns, so re-scope their SELECT to an
-- explicit allowlist of the pre-existing columns. Row-level self-select stays
-- (the llm_usage_log_select_own policy is untouched) — critically, the cost
-- guard's daily-cap COUNT(id) still works because id remains granted. Admin
-- reads go through the service client, which bypasses both RLS and grants.
revoke select on public.llm_usage_log from authenticated;
grant select (
  id, user_id, call_type, model, prompt_tokens, completion_tokens,
  total_tokens, duration_ms, metadata, created_at, deleted_at,
  anonymised_at, tool_name
) on public.llm_usage_log to authenticated;

revoke select on public.llm_usage_log from anon;
grant select (
  id, user_id, call_type, model, prompt_tokens, completion_tokens,
  total_tokens, duration_ms, metadata, created_at, deleted_at,
  anonymised_at, tool_name
) on public.llm_usage_log to anon;

-- Verification: expect the four new columns.
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'llm_usage_log'
  and column_name in ('computed_cost_usd', 'cache_read_tokens', 'cache_write_tokens', 'rate_version')
order by column_name;

commit;
