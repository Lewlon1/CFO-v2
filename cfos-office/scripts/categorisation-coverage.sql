-- Auto-categorisation coverage report.
-- Run against a CFO database (psql or the Supabase SQL editor / MCP) to measure
-- how much of the transaction set is auto-categorised, and where the gaps are.
-- A transaction is "categorised" when transactions.category_id IS NOT NULL.

-- 1) Headline coverage (traditional + value category)
select
  count(*)                                                          as total_txns,
  count(*) filter (where category_id is not null)                   as categorised,
  round(100.0 * count(*) filter (where category_id is not null) / nullif(count(*), 0), 1) as coverage_pct,
  count(*) filter (where value_category is not null and value_category <> 'unsure') as value_categorised,
  round(100.0 * count(*) filter (where value_category is not null and value_category <> 'unsure') / nullif(count(*), 0), 1) as value_pct,
  count(distinct user_id)                                           as users
from public.transactions
where deleted_at is null;

-- 2) Coverage by parse source (pdf/screenshot tend to lag csv)
select coalesce(source, '(null)') as source,
       count(*) as total,
       count(*) filter (where category_id is not null) as categorised,
       round(100.0 * count(*) filter (where category_id is not null) / nullif(count(*), 0), 1) as pct
from public.transactions
where deleted_at is null
group by 1 order by total desc;

-- 3) Inflow vs outflow — transfers/income inflows shouldn't count as spend failures
select case when amount >= 0 then 'inflow/transfer' else 'outflow' end as kind,
       count(*) as total,
       count(*) filter (where category_id is null) as uncategorised,
       round(100.0 * count(*) filter (where category_id is null) / nullif(count(*), 0), 1) as uncat_pct
from public.transactions
where deleted_at is null
group by 1 order by 1;

-- 4) Is the LLM fallback actually running? (expect 'categorisation' rows once imports flow)
select call_type, count(*) n, max(created_at) last_seen
from public.llm_usage_log
group by 1 order by n desc;

-- 5) The current uncategorised tail (feed candidates for new rules / LLM)
select lower(trim(description)) as descr, count(*) as n
from public.transactions
where deleted_at is null and category_id is null
group by 1 order by n desc limit 50;
