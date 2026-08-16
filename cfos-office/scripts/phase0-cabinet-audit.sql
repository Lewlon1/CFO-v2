-- Filing cabinet — Phase 0 read-only audit.
--
-- Run this FIRST, against STAGING (qlbhvlssksnrhsleadzn), before believing any
-- A/B result. Every statement is a SELECT; nothing here writes.
--
-- It answers four questions, in the order that can save you the most work:
--   1. Is migration 082 even applied? If not, the cabinet contract and its three
--      tools shipped in the prompt while every read errored — the UI hides that
--      by design — so any "the cabinet made no difference" observation was made
--      against a cabinet that could not work. Stop and apply 082 first.
--   2. Did the cabinet tools actually fire, and did they error?
--   3. Does the test user have any files? An empty cabinet renders an empty
--      index, so "no improvement" is the expected result, not evidence against.
--   4. Were the onboarding numbers wrong for a reason that has nothing to do
--      with the prompt — i.e. a MODELLED free-cash figure that assumes zero
--      day-to-day spending?
--
-- Replace :user_id with the test user's uuid before running §3 and §4.

-- ── 1. Is migration 082 applied? ────────────────────────────────────────────
-- Expect two rows. Zero rows = the cabinet has no storage; that alone explains
-- both "no difference" and any read failure.
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('memory_files', 'memory_file_revisions')
order by table_name;

-- Column discovery before anything below assumes a shape (CLAUDE.md rule 4 —
-- the live schema has diverged from the docs before).
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('memory_files', 'llm_usage_log', 'monthly_snapshots')
order by table_name, ordinal_position;

-- ── 2. Did the cabinet tools fire? ──────────────────────────────────────────
-- tool_name is a real column (migration 042), not a metadata key.
select tool_name,
       count(*)                        as calls,
       count(distinct user_id)         as users,
       min(created_at)                 as first_call,
       max(created_at)                 as last_call
from public.llm_usage_log
where call_type = 'tool_call'
  and tool_name in ('read_memory_file', 'write_memory_file', 'archive_memory_file')
  and created_at > now() - interval '30 days'
group by tool_name
order by calls desc;

-- Zero rows here while the cabinet was "on" is the headline finding: the model
-- was told reading was mandatory and never read. Compare against total tool
-- traffic in the same window to be sure tools were being called at all.
select coalesce(tool_name, '(none)') as tool_name, count(*) as calls
from public.llm_usage_log
where call_type = 'tool_call' and created_at > now() - interval '30 days'
group by 1
order by calls desc
limit 20;

-- ── 3. Does the test user have a cabinet at all? ────────────────────────────
-- Run only if §1 returned the tables.
select folder,
       slug,
       length(content)                            as content_chars,
       user_edited_at is not null                 as user_edited,
       is_pinned,
       is_archived,
       updated_at
from public.memory_files
where user_id = :'user_id'
order by folder, slug;

-- ── 4. Were the onboarding numbers modelled rather than observed? ───────────
-- total_discretionary IS NULL ⇒ getFinancialPosition falls back to
-- freeCash = income − fixedCosts with basis='modelled', which assumes ZERO
-- day-to-day spending. That is the most likely source of a figure that felt
-- wrong, and it is a data-pipeline bug, not a prompt-size one.
select month,
       total_income,
       total_spending,
       total_fixed_costs,
       total_discretionary,
       (total_discretionary is null) as would_be_modelled
from public.monthly_snapshots
where user_id = :'user_id'
order by month desc
limit 6;

-- What the composer actually ran, and how big its prompt was. metadata->>'mode'
-- says which of the five Read prompts was used.
select created_at,
       metadata->>'mode'            as mode,
       metadata->>'prompt_hash'     as prompt_hash,       -- null before Phase 5
       metadata->>'memory_files_enabled' as cabinet,      -- null before Phase 5
       prompt_tokens,
       completion_tokens,
       computed_cost_usd
from public.llm_usage_log
where call_type = 'first_read_compose'
  and created_at > now() - interval '30 days'
order by created_at desc
limit 20;

-- The validators are non-blocking everywhere (compose logs to console only;
-- chat is gated behind SHOW_QA_NOTES, off by default), so a hallucinated or
-- unsupported figure leaves ONLY this row behind. The payload carries the
-- numbers that failed the citation allowlist.
select created_at,
       event_type,
       metadata
from public.user_events
where event_type in ('first_read_validator_fired', 'chat_validator_fired')
  and created_at > now() - interval '30 days'
order by created_at desc
limit 20;
