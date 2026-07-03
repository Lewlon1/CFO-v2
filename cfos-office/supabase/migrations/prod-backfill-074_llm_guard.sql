-- prod-backfill-074_llm_guard.sql
--
-- ⚠️ PRODUCTION-ONLY, MANUAL. Lewis runs this by hand against
-- iccelmjenljanqrhhzdv. It is NOT applied by automation.
--
-- Identical to staging migration 074: adds the LLM cost-guard's per-user
-- block flag to user_profiles. Additive-only, no data backfill (null = not
-- blocked). Safe to run at any time; the app tolerates the column being
-- absent (the guard read fails open) until the code ships, and tolerates the
-- column existing before the code ships (nothing writes it).
--
--   set:   update user_profiles set llm_blocked_at = now() where id = '<uuid>';
--   clear: update user_profiles set llm_blocked_at = null  where id = '<uuid>';

begin;

alter table public.user_profiles
  add column if not exists llm_blocked_at timestamptz;

comment on column public.user_profiles.llm_blocked_at is
  'When set, all user-triggerable LLM calls are refused (friendly block, no Bedrock spend). Set/clear manually to stop a runaway or abusive account. Enforced by src/lib/ai/llm-guard.ts.';

-- Verification: expect exactly one row.
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'user_profiles'
  and column_name = 'llm_blocked_at';

commit;
