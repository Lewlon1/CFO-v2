alter table public.monthly_snapshots
  add column if not exists value_breakdown jsonb;

comment on column public.monthly_snapshots.value_breakdown
  is 'Computed totals per value_category: {foundation, investment, leak, burden, unsure, unclassified}';
