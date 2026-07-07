-- prod-backfill-081_llm_usage_cost.sql
--
-- ⚠️ PRODUCTION-ONLY, MANUAL. Lewis runs this by hand against
-- iccelmjenljanqrhhzdv. It is NOT applied by automation.
--
-- Identical to staging migration 081: adds the cost meter's per-call cost +
-- cache-token columns to llm_usage_log and re-scopes authenticated/anon SELECT
-- so the cost/rate columns are service-role/admin-only. Additive-only, no data
-- backfill (null cost = pre-meter rows). Safe to run at any time: the app
-- tolerates the columns being absent (cost writes are fire-and-forget and the
-- guard counts rows, not cost) until the code ships, and tolerates the columns
-- existing before the code ships (nothing writes them).
--
-- Before running, sanity-check that llm_usage_log on prod still has exactly the
-- pre-existing columns listed in the grant allowlist below; if a prior prod
-- migration added a column, add it to BOTH grant lists or that column becomes
-- unreadable to authenticated/anon.
--
--   who spent what today:
--     select call_type, count(*), sum(total_tokens), sum(computed_cost_usd)
--     from llm_usage_log
--     where created_at >= date_trunc('day', now()) group by 1 order by 4 desc nulls last;

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

-- G4 — cost/rate columns service-role/admin-only (see staging 081 for rationale).
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
