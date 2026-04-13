-- Prediction metrics RPC function
-- Requires: migration 031 (correction_signals) for prediction_source column
create or replace function prediction_metrics_txn(p_user_id uuid)
returns json language sql stable security definer as $$
  select json_build_object(
    'total', count(*),
    'confirmed', count(*) filter (where prediction_source = 'user_confirmed'),
    'predicted', count(*) filter (where prediction_source is not null and prediction_source != 'user_confirmed' and value_category != 'no_idea'),
    'uncategorised', count(*) filter (where value_category = 'no_idea' or value_category is null),
    'avg_confidence', round(avg(value_confidence) filter (where prediction_source is not null and prediction_source != 'user_confirmed'), 2),
    'high_confidence_pct', round(
      count(*) filter (where value_confidence >= 0.75 and prediction_source != 'user_confirmed')::numeric
      / nullif(count(*) filter (where prediction_source is not null and prediction_source != 'user_confirmed'), 0),
      2
    ),
    'low_confidence_pct', round(
      count(*) filter (where value_confidence < 0.25 and prediction_source != 'user_confirmed')::numeric
      / nullif(count(*) filter (where prediction_source is not null and prediction_source != 'user_confirmed'), 0),
      2
    )
  )
  from transactions
  where user_id = p_user_id;
$$;
