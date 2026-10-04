-- Filing cabinet / onboarding-numbers — Phase 0 read-only audit.
--
-- Run against STAGING (qlbhvlssksnrhsleadzn). Every statement is a SELECT.
--
-- Column names below are the LIVE ones, verified 2026-08-16 against staging —
-- not the ones the docs imply. Three of them bite (CLAUDE.md rule 4):
--   memory_files uses `pinned` / `archived_at`, NOT is_pinned / is_archived
--   user_events  uses `profile_id` / `payload`, NOT user_id / metadata
--   monthly_snapshots has NO `total_discretionary` on staging — see §4, that
--                     absence is the finding, not a typo
--
-- Replace :'user_id' with the test user's uuid for §3 and §4.

-- ── 0. Migration drift ──────────────────────────────────────────────────────
-- The registry (supabase_migrations.schema_migrations) stops at 077, but 081
-- and 082 were applied anyway — so the registry cannot be trusted here and the
-- artifacts have to be probed directly.
--
-- Staging on 2026-08-16: 079 = 0 (MISSING), 081 = 1, 082 = 1.
-- Production        : all three 0.
select
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='monthly_snapshots'
       and column_name='total_discretionary')            as m079_total_discretionary,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='llm_usage_log'
       and column_name='computed_cost_usd')              as m081_computed_cost,
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='memory_files') as m082_memory_files;

-- ── 1. Does the cabinet have storage? ───────────────────────────────────────
select table_name
from information_schema.tables
where table_schema='public'
  and table_name in ('memory_files','memory_file_revisions')
order by table_name;

-- ── 2. Did the cabinet tools ever fire? ─────────────────────────────────────
-- Zero rows here is the headline: the contract told the model reading was
-- MANDATORY and it never read once.
select tool_name, count(*) as calls, count(distinct user_id) as users,
       min(created_at) as first_call, max(created_at) as last_call
from public.llm_usage_log
where call_type='tool_call'
  and tool_name in ('read_memory_file','write_memory_file','archive_memory_file')
group by tool_name
order by calls desc;

-- The control that stops §2 being misread as broken logging: other tools DO
-- log (create_goal, get_spending_summary, …). If this is populated and §2 is
-- empty, the zero is behavioural, not an instrumentation gap.
select coalesce(tool_name,'(null)') as tool_name, count(*) as calls,
       max(created_at) as last_call
from public.llm_usage_log
where call_type='tool_call'
group by 1 order by calls desc limit 15;

-- ── 3. What is actually in the cabinet? ─────────────────────────────────────
-- source='system' means fileComposedRead wrote it (a copy of the Read), not the
-- CFO choosing to record something. A cabinet of nothing but `values/first-read`
-- has nothing to retrieve that the user has not just been shown.
select user_id, folder::text, slug, source::text, updated_by::text,
       length(content) as chars,
       user_edited_at is not null as user_edited,
       pinned, archived_at is not null as archived,
       created_at, updated_at
from public.memory_files
order by created_at;

-- ── 4. Why the onboarding numbers are wrong ─────────────────────────────────
-- financial-position.ts:73 selects `total_spending, total_discretionary`. When
-- migration 079 is unapplied that column does not exist, PostgREST rejects the
-- whole select (42703), `.data` is null, rows = [], avgDiscretionaryMonthly is
-- null — and basis falls through to 'modelled' for EVERY user, unconditionally.
-- freeCash then equals income − fixedCosts, counting no day-to-day spending at
-- all, and the prompt asserts "no real spending history exists yet".
--
-- This query shows the contradiction directly: real transactions and real
-- monthly spending, against a snapshot row that cannot supply discretionary.
select p.id,
       p.net_monthly_income,
       p.monthly_rent,
       (select count(*) from public.transactions t
          where t.user_id=p.id and t.deleted_at is null)      as txns,
       (select count(*) from public.monthly_snapshots s
          where s.user_id=p.id)                               as snapshots,
       (select round(avg(s.total_spending),2) from public.monthly_snapshots s
          where s.user_id=p.id)                               as avg_monthly_spend,
       -- What the Read would have called "free cash": income − declared rent.
       (p.net_monthly_income - coalesce(p.monthly_rent,0))     as modelled_free_cash
from public.user_profiles p
where p.id = :'user_id';

-- Snapshot detail. total_fixed_costs NULL and total_income 0 alongside a
-- healthy transaction_count are themselves signals the snapshot refresh never
-- completed for this user.
select month, total_income, total_spending, total_fixed_costs, transaction_count
from public.monthly_snapshots
where user_id = :'user_id'
order by month desc
limit 6;

-- ── 5. What the composer ran, and what the validators saw ───────────────────
select created_at,
       metadata->>'mode'                 as mode,
       metadata->>'prompt_hash'          as prompt_hash,      -- null before Phase 5
       metadata->>'memory_files_enabled' as cabinet,          -- null before Phase 5
       prompt_tokens, completion_tokens, computed_cost_usd
from public.llm_usage_log
where call_type='first_read_compose'
order by created_at desc
limit 20;

-- Validators are non-blocking everywhere, so a bad figure leaves only this row.
-- NOTE: an empty result does NOT mean the numbers were right. The citation
-- validator checks the prose against the facts it was HANDED — when the facts
-- themselves are wrong, a faithful quotation passes cleanly. That is exactly
-- what happened here.
select created_at, event_type, payload
from public.user_events
where event_type in ('first_read_validator_fired','chat_validator_fired')
order by created_at desc
limit 20;

-- Which Read modes ran, and into which conversation.
select created_at, event_type, payload
from public.user_events
where event_type = 'read_composed'
order by created_at desc
limit 10;
