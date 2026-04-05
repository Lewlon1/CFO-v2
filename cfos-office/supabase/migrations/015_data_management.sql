-- Session 12: Data Management & Trust Transparency
-- Import history RPC function for grouping transactions by import batch

create or replace function get_import_history(p_user_id uuid)
returns table (
  import_batch_id uuid,
  source text,
  transaction_count bigint,
  earliest_date timestamptz,
  latest_date timestamptz,
  imported_at timestamptz
) as $$
  select
    t.import_batch_id,
    t.source,
    count(*) as transaction_count,
    min(t.date) as earliest_date,
    max(t.date) as latest_date,
    min(t.created_at) as imported_at
  from transactions t
  where t.user_id = p_user_id
    and t.import_batch_id is not null
  group by t.import_batch_id, t.source
  order by min(t.created_at) desc;
$$ language sql security definer;
